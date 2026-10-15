// Writes the update manifest Firefox polls (browser_specific_settings.gecko.update_url)
// so installed copies update themselves to the newest signed release.
// Usage: node scripts/updates-json.js <xpi-file-name> > updates.json
const manifest = require("../manifest.json");
const repo = process.env.GITHUB_REPOSITORY || "Lin-Jacob/Interview-Extension";
const { id } = manifest.browser_specific_settings.gecko;
const version = manifest.version;
const xpi = process.argv[2];
if (!xpi) throw new Error("Pass the .xpi file name.");
process.stdout.write(JSON.stringify({
  addons: {
    [id]: {
      updates: [{ version, update_link: `https://github.com/${repo}/releases/download/v${version}/${xpi}` }]
    }
  }
}, null, 2) + "\n");
