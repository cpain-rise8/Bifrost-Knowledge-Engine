/**
 * BIFROST OUTCOME SYNTHESIS ENGINE (Saved in Outcomes.gs)
 */

/**
 * PRIMARY CONTROLLER ROUTINE (Enhanced for Full Raw Document Retrieval)
 */
function generateOutcomeStatement(initiativeText) {
  if (!initiativeText || initiativeText.trim() === "") {
    return { success: false, error: "Please provide a valid engineering initiative overview description." };
  }

  try {
    // 1. Vectorize the high-level description
    let queryVector;
    try {
      queryVector = getSingleGeminiEmbedding(initiativeText);
    } catch (err) {
      return { success: false, error: "⚠️ Failed to vectorize initiative query. API transmission line exception." };
    }

    // 2. Fetch semantic matches from Firestore
    const topMatches = queryFirestoreVectorIndex("knowledge_index", queryVector, 8);
    
    if (topMatches.length === 0) {
      return { 
        success: false, 
        error: "Could not locate any matching historical context updates inside your database to build supporting evidence." 
      };
    }

    // 3. Dynamic Hydration: Fetch the FULL uninterrupted raw text for unique matching documents
    let contextBlock = "";
    let sourceTracking = {};
    let processedFileIds = new Set();
    
    topMatches.forEach((match) => {
      if (match.doc_url) {
        sourceTracking[match.doc_title] = match.doc_url;
        
        const fileIdMatch = match.doc_url.match(/\/d\/([a-zA-Z0-9-_]+)/);
        if (fileIdMatch && fileIdMatch[1]) {
          const fileId = fileIdMatch[1];
          
          if (!processedFileIds.has(fileId)) {
            processedFileIds.add(fileId);
            
            // Pull the raw text from the entire document dynamically
            const fullRawTranscript = extractTextFromNotesTabViaREST(fileId);
            
            if (fullRawTranscript && fullRawTranscript.trim().length > 0) {
              contextBlock += `\n[FULL UNINTERRUPTED STANDUP NOTE DOCUMENT | Source: ${match.doc_title}]\n${fullRawTranscript}\n---\n`;
            } else {
              contextBlock += `\n[DOCUMENT EXCERPT SNIPPET | Source: ${match.doc_title}]\n${match.text_chunk}\n---\n`;
            }
          }
        }
      } else {
        contextBlock += `\n[DOCUMENT EXCERPT SNIPPET]\n${match.text_chunk}\n---\n`;
      }
    });

    // 4. Fire the complete documents into Gemini 2.5 Flash
    const synthesizedOutput = requestStructuredOutcomeFromLLM(initiativeText, contextBlock);

    // 5. Package clean citation list arrays
    let citations = [];
    for (let title in sourceTracking) {
      let cleanTitle = title.replace(" - Notes by Gemini", "");
      citations.push({ title: cleanTitle, url: sourceTracking[title] });
    }

    return {
      success: true,
      markdownContent: synthesizedOutput,
      citations: citations
    };

  } catch (globalError) {
    return { success: false, error: "Core Synthesis Pipeline Exception Error: " + globalError.toString() };
  }
}

/**
 * STRATEGY GENERATION PROMPT PLATFORM
 * Enforces strict section styling definitions over the returned data structures.
 */
function requestStructuredOutcomeFromLLM(initiative, contextBlock) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;
  
  const systemInstructions = `You are a straightforward, direct Principal Systems Engineer. ` +
                 `Your task is to write a highly concise, plain-language 'Outcome Statement' for this exact initiative: "${initiative}".\n\n` +
                 `[SCOPE CONSTRAINT]: Laser-focus *only* on the core mechanics of the input subject. Do not mention adjacent engineering updates, general tracking metrics, secondary tasks, or unrelated team blockers found in the source text. If a standup detail does not directly build or impact "${initiative}", omit it completely.\n\n` +
                 `[STYLE GUIDE]:\n` +
                 `* Voice: Use a direct, active voice (e.g., write "The team deployed X" instead of "Implementation of X was realized by the engineering org").\n` +
                 `* Diction: Use plain language. Avoid corporate buzzwords, hand-waving hyperbole, or speculative strategic filler. Stick to cold, technical facts.\n` +
                 `* Brevity: Be extremely brief. Limit sections 1 through 4 to a maximum of 2 to 3 punchy sentences each.\n\n` +
                 `[HISTORICAL TEAM STANDUP DATA]:\n${contextBlock}\n\n` +
                 `Provide the response using these exact markdown headings. Do not include any conversational introductions, greetings, or conclusions before or after the headings:\n\n` +
                 `## 1. Problem\n(What exact technical pain point, friction, or blocker did this specific work solve? Max 2-3 sentences.)\n\n` +
                 `## 2. Output\n(What concrete code, architecture, framework, or configuration was built? Max 2-3 sentences.)\n\n` +
                 `## 3. Outcome\n(What was the direct operational impact on engineering velocity, pipeline stability, or security? Max 2-3 sentences.)\n\n` +
                 `## 4. Future Enabled\n(What specific technical capability or product path is unlocked now that this foundation is set? Max 1-2 sentences.)\n\n` +
                 `## 5. Supporting Evidence Matrix\n(Provide a maximum of 3 brief, single-line bullet points referencing explicit names, dates, or technical updates from the text to validate the claims above.)`;

  const payload = { "contents": [{ "parts": [{ "text": systemInstructions }] }] };
  const options = {
    "method": "post",
    "contentType": "application/json",
    "payload": JSON.stringify(payload),
    "muteHttpExceptions": true
  };

  const response = UrlFetchApp.fetch(url, options);
  if (response.getResponseCode() !== 200) {
    throw new Error(`The generation node failed to formulate the corporate framework profile [Code ${response.getResponseCode()}].`);
  }
  
  const json = JSON.parse(response.getContentText());
  return json.candidates[0].content.parts[0].text;
}
