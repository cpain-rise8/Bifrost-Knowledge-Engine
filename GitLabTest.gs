/**
 * PRODUCTION IAP + GITLAB PAT AUTHENTICATION ENGINE
 * Leverages the default compute service account to sign custom audience tokens.
 */
function verifyGitLabConnectivity() {
  // 🚨 CONFIGURATION CORNER
  const GITLAB_PAT = "glpat-Z5zsq3-JLLDWl9u85qCjlG86MQp1OjRqCA.01.0y007w8ii"; // Replace with your GitLab token
  const IAP_CLIENT_ID = "609058160932-362kfcrhrubdp1tmmpcaenc7h5gg35v4.apps.googleusercontent.com"; // Ensure the full suffix is attached
  
  const SERVICE_ACCOUNT = "47873772432-compute@developer.gserviceaccount.com";
  const BASE_URL = "https://gitlab.gl.rise8.us";
  
  Logger.log("🔐 Requesting custom IAP identity token from Google IAMCredentials engine...");
  
  let iapTargetToken;
  try {
    const iamUrl = `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${SERVICE_ACCOUNT}:generateIdToken`;
    const iamPayload = {
      "audience": IAP_CLIENT_ID,
      "includeEmail": true
    };
    const iamOptions = {
      "method": "post",
      "contentType": "application/json",
      "headers": { "Authorization": "Bearer " + ScriptApp.getOAuthToken() }, // Authenticates using your developer session
      "payload": JSON.stringify(iamPayload),
      "muteHttpExceptions": true
    };
    
    const iamResponse = UrlFetchApp.fetch(iamUrl, iamOptions);
    const iamStatus = iamResponse.getResponseCode();
    const iamBody = iamResponse.getContentText();
    
    if (iamStatus !== 200) {
      throw new Error(`Google IAM rejected token request [Status ${iamStatus}]: ${iamBody}`);
    }
    
    iapTargetToken = JSON.parse(iamBody).token;
    Logger.log("✅ Custom audience token successfully generated via Service Account.");
    
  } catch (tokenErr) {
    Logger.log(`💥 TOKEN GENERATION FAILURE: ${tokenErr.toString()}`);
    Logger.log("💡 Double-check that your personal email has been granted the 'Service Account Token Creator' role.");
    return;
  }
  
  // 🚀 DISPATCH TO GITLAB ENTERPRISE OVER NATIVE IAP
  const url = `${BASE_URL}/api/v4/user`;
  const gitlabOptions = {
    "method": "get",
    "headers": {
      "Authorization": `Bearer ${iapTargetToken}`, // Clears the Google Cloud IAP Network Gatekeeper
      "PRIVATE-TOKEN": GITLAB_PAT                 // Clears the GitLab Application Access Control
    },
    "muteHttpExceptions": true
  };
  
  Logger.log("Encoding tokens and transmitting secure validation packet to GitLab...");
  try {
    const response = UrlFetchApp.fetch(url, gitlabOptions);
    const status = response.getResponseCode();
    const rawBody = response.getContentText();
    
    Logger.log(`[GitLab Response] Status Code: ${status}`);
    
    // 🔍 DEFENSIVE HTML DETECTOR
    if (rawBody.trim().startsWith("<")) {
      const titleMatch = rawBody.match(/<title>(.*?)<\/title>/i);
      const pageTitle = titleMatch ? titleMatch[1] : "Unknown Title";
      
      Logger.log(`⚠️ INTERCEPTION DETECTED at Status 200!`);
      Logger.log(`🖥️ Webpage Title: "${pageTitle}"`);
      Logger.log(`📄 Code Snippet: \n${rawBody.substring(0, 250)}...`);
      return;
    }
    
    const userData = JSON.parse(rawBody);
    Logger.log(`🎉 SUCCESS! Connected through IAP network layer.`);
    Logger.log(`👋 Authenticated App User: ${userData.name} (@${userData.username})`);
    
  } catch (networkErr) {
    Logger.log(`💥 NETWORK ROUTING ERROR: ${networkErr.toString()}`);
  }
}

// Variable for project specific path
/*
const PROJECT_PATH = "rise8-all%2Fdelivery%2Fengagements%2Fspace-domain%2Fussf%2Fbifrost%2Fapollo-charts";
  const GITLAB_PAT = "glpat-Z5zsq3-JLLDWl9u85qCjlG86MQp1OjRqCA.01.0y007w8ii"; 
  const BASE_URL = "https://gitlab.gl.rise8.us"; 
  const url = `${BASE_URL}/api/v4/user`;
  Client ID = 👉 609058160932-362kfcrhrubdp1tmmpcaenc7h5gg35v4.apps.googleusercontent.com
*/
