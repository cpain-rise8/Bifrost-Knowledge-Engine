/**
 * BIFROST FIRESTORE VECTOR SEARCH ENGINE & ROUTER (Saved in Code.gs)
 */

/**
 * Serves the core HTML frontends based on URL query routing parameters
 */
function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
      .setTitle('Bifrost Intelligence Workspace')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * PRIMARY WEB APP ENTRY POINT (Enhanced for Full Raw Document Retrieval)
 * Called asynchronously from your HTML interface when a user submits a query.
 */
function askStandupNotes(question, chatHistory) {
  if (!question || question.trim() === "") return "Please provide a valid question.";

  try {
    // 1. Vectorize the user's incoming question using the active Embedding 1 model
    let queryVector;
    try {
      queryVector = getSingleGeminiEmbedding(question);
    } catch (err) {
      return "⚠️ Failed to vectorize your query. Please verify your Gemini API connection.";
    }

    // 2. Execute a Native Nearest Neighbor (KNN) Vector Query directly on Firestore
    const topMatches = queryFirestoreVectorIndex("knowledge_index", queryVector, 5);
    
    if (topMatches.length === 0) {
      return "I searched our Firestore knowledge repository but couldn't find any matching context updates.";
    }

    // 3. 🧠 SAFE HYDRATION LAYER: Fetch the FULL raw text tree for unique matching documents
    let contextBlock = "";
    let sourceTracking = {};
    let processedFileIds = new Set(); // Guard rail to prevent redundant API hits on the same file
    
    topMatches.forEach((match) => {
      if (match.doc_url) {
        sourceTracking[match.doc_title] = match.doc_url; // Collects unique links for the UI
        
        // Extract the unique Google Doc File ID using regex
        const fileIdMatch = match.doc_url.match(/\/d\/([a-zA-Z0-9-_]+)/);
        if (fileIdMatch && fileIdMatch[1]) {
          const fileId = fileIdMatch[1];
          
          // Deduplication Check: Only fetch the full text if we haven't seen this document yet
          if (!processedFileIds.has(fileId)) {
            processedFileIds.add(fileId);
            
            // Reuses the advanced REST reader utility from Ingestion.gs
            const fullRawTranscript = extractTextFromNotesTabViaREST(fileId);
            
            // Fallback Guard: Ensure the text came back successfully before swapping it
            if (fullRawTranscript && fullRawTranscript.trim().length > 0) {
              contextBlock += `\n[FULL UNINTERRUPTED STANDUP NOTE DOCUMENT | Source: ${match.doc_title}]\n${fullRawTranscript}\n---\n`;
            } else {
              // Safety Fallback: Use the original vector snippet chunk if the live Doc fetch failed
              contextBlock += `\n[DOCUMENT EXCERPT SNIPPET | Source: ${match.doc_title}]\n${match.text_chunk}\n---\n`;
            }
          }
        }
      } else {
        contextBlock += `\n[DOCUMENT EXCERPT SNIPPET]\n${match.text_chunk}\n---\n`;
      }
    });

    // 4. Hand the complete contextual documents off to Gemini 2.5 Flash to synthesize a response
    let aiResponse = generateAnswerFromContext(question, contextBlock, chatHistory);

    // 5. Append clean markdown citations dynamically to the bottom of the message
    let citationString = "\n\n**Sources Referenced:**";
    let hasCitations = false;
    for (let title in sourceTracking) {
      let cleanTitle = title.replace(" - Notes by Gemini", "");
      citationString += `\n* [${cleanTitle}](${sourceTracking[title]})`;
      hasCitations = true;
    }

    return hasCitations ? aiResponse + citationString : aiResponse;

  } catch (globalError) {
    return "Core Retrieval System Exception Error: " + globalError.toString();
  }
}

/**
 * FIRESTORE VECTOR SEARCH ROUTINE (Cloud Run Functions Proxy Channel)
 */
function queryFirestoreVectorIndex(collection, vectorArray, limit = 5) {
  const CLOUD_RUN_FUNCTION_URL = "https://bifrost-vector-search-47873772432.us-central1.run.app"; 
  const PROXY_SECRET_TOKEN = "Bifrost_Secure_Bridge_Token_2026"; 
  
  const payload = {
    "vector": vectorArray,
    "limit": limit,
    "collection": collection
  };
  
  Logger.log("🚀 SENDING TO CLOUD RUN: " + JSON.stringify(payload).substring(0, 200) + "...");

  const options = {
    "method": "post",
    "contentType": "application/json",
    "headers": { "X-Bifrost-Key": PROXY_SECRET_TOKEN },
    "payload": JSON.stringify(payload),
    "muteHttpExceptions": true
  };
  
  const response = UrlFetchApp.fetch(CLOUD_RUN_FUNCTION_URL, options);
  
  if (response.getResponseCode() !== 200) {
    throw new Error(`Cloud Run Proxy Endpoint Gateway Failure [Code ${response.getResponseCode()}]: ${response.getContentText()}`);
  }
  
  const data = JSON.parse(response.getContentText());
  return data.results; 
}

/**
 * FETCH SINGLE VECTOR
 */
function getSingleGeminiEmbedding(text) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${GEMINI_API_KEY}`;
  const payload = {
    "model": "models/gemini-embedding-001",
    "content": { "parts": [{ "text": text }] },
    "output_dimensionality": 768
  };
  const options = {
    "method": "post",
    "contentType": "application/json",
    "payload": JSON.stringify(payload),
    "muteHttpExceptions": true 
  };
  
  const response = UrlFetchApp.fetch(url, options);
  if (response.getResponseCode() !== 200) throw new Error("Embedding fetch failed.");
  return JSON.parse(response.getContentText()).embedding.values;
}

/**
 * CONTEXTUAL GENERATION PHASE via Gemini 2.5 Flash
 */
function generateAnswerFromContext(question, contextBlock, chatHistory) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;
  
  let historyText = "";
  if (chatHistory && chatHistory.length > 0) {
    historyText = "\n\n[CONVERSATION HISTORY]\n" + chatHistory.map(turn => {
      return `${turn.sender === 'user' ? 'User' : 'AI'}: ${turn.text}`;
    }).join("\n");
  }

  const systemInstructions = `You are the Bifrost Team Intelligence Assistant, a supportive and technical AI collaborator. ` +
                 `Your goal is to answer the user's question using the complete, un-truncated standup note documents provided below. ` +
                 `Be precise, direct, and retain crucial technical data points (like ADR names, Jira blockers, platform decisions, and milestones). ` +
                 `If the source material mentions specific names, attribute tasks accurately. ` +
                 `Do not make outside assumptions or hallucinate context that isn't explicitly detailed in the source texts.\n\n` +
                 `[FULL ARCHIVE DOCUMENTS]\n${contextBlock}` + 
                 `${historyText}\n\n` +
                 `Current User Question: ${question}`;

  const payload = { "contents": [{ "parts": [{ "text": systemInstructions }] }] };
  const options = {
    "method": "post",
    "contentType": "application/json",
    "payload": JSON.stringify(payload),
    "muteHttpExceptions": true
  };

  const response = UrlFetchApp.fetch(url, options);
  if (response.getResponseCode() !== 200) return "⚠️ The generation node encountered an issue formulating your final response summary.";
  
  const json = JSON.parse(response.getContentText());
  return json.candidates[0].content.parts[0].text;
}
