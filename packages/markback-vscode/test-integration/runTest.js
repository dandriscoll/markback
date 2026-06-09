const path = require("node:path");
const https = require("node:https");
const { runTests } = require("@vscode/test-electron");

// `@vscode/test-electron` uses Node's `https` directly and does NOT consult
// `HTTPS_PROXY`. On networks where the VS Code CDN is only reachable through
// an outbound proxy, this means the download stalls or times out. Install an
// `https-proxy-agent` as the global agent so the downloader (and any other
// `https` consumer in this process) routes through `HTTPS_PROXY`.
const proxyUrl =
  process.env.HTTPS_PROXY ||
  process.env.https_proxy ||
  process.env.HTTP_PROXY ||
  process.env.http_proxy;
if (proxyUrl) {
  const { HttpsProxyAgent } = require("https-proxy-agent");
  https.globalAgent = new HttpsProxyAgent(proxyUrl);
}

async function main() {
  try {
    const extensionDevelopmentPath = path.resolve(__dirname, "..");
    const extensionTestsPath = path.resolve(__dirname, "suite", "index.js");

    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: ["--disable-extensions", "--disable-workspace-trust"],
    });
  } catch (err) {
    console.error("Integration tests failed.");
    console.error(err);
    process.exit(1);
  }
}

main();
