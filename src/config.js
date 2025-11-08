import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CONFIG_FILE_PATH = path.join(__dirname, '..', 'config.json');

function readConfig() {
    try {
        const configFileContent = fs.readFileSync(CONFIG_FILE_PATH, 'utf8');
        return JSON.parse(configFileContent);        
    } catch (error) {
        console.error('Error reading or parsing config.json:', error.message);
        throw error;
    }
}

function writeConfig(newConfig) {
    try {
        const configString = JSON.stringify(newConfig, null, 4);
        fs.writeFileSync(CONFIG_FILE_PATH, configString, 'utf8');
    } catch (error) {
        console.error('Error writing to config.json:', error.message);
        throw error;
    }
}

function get() {
    const config = readConfig();
    return config;
}

function set(key, value) {
    const config = readConfig();
    config[key] = value;
    writeConfig(config);
}

export {
    readConfig,
    writeConfig,
    get,
    set,
};

// console.log(readConfig());