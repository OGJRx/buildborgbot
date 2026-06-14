const fs = require('fs');
const { execSync } = require('child_process');

const BOTS_CONFIG_PATH = './bots.json';

function syncSecrets() {
  if (!fs.existsSync(BOTS_CONFIG_PATH)) {
    console.error(`Error: Configuration file not found at ${BOTS_CONFIG_PATH}`);
    process.exit(1);
  }

  const bots = JSON.parse(fs.readFileSync(BOTS_CONFIG_PATH, 'utf8'));

  bots.forEach((bot) => {
    try {
      console.log(`Setting secret ${bot.secretName} for ${bot.workerName}...`);
      
      // Use wrangler to set the secret. 
      // Assumes wrangler is installed in devDependencies.
      execSync(`echo "${bot.value}" | npx wrangler secret put ${bot.secretName} --name ${bot.workerName}`, {
        stdio: 'inherit',
      });
      
      console.log(`Successfully set ${bot.secretName} for ${bot.workerName}.`);
    } catch (error) {
      console.error(`Failed to set secret ${bot.secretName} for ${bot.workerName}:`, error.message);
      process.exit(1);
    }
  });
}

syncSecrets();
