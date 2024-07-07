const TelegramBot = require('node-telegram-bot-api');
const nodemailer = require('nodemailer');
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const { telegramToken, dbPath } = require('./settingss');
const { replacePlaceholders } = require('./placeholders');

// Initialize the bot
const bot = new TelegramBot(telegramToken, { polling: true });

// Ensure attachments and uploads directories exist
const attachmentsDir = path.resolve(__dirname, 'attachments');
const uploadsDir = path.resolve(__dirname, 'uploads');

async function ensureDirectoryExists(dir) {
  try {
    await fsp.access(dir);
  } catch (error) {
    await fsp.mkdir(dir);
  }
}

(async () => {
  await ensureDirectoryExists(attachmentsDir);
  await ensureDirectoryExists(uploadsDir);
})();

// Database setup
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Could not connect to database:', err);
  } else {
    console.log('Connected to database');
    updateDatabaseSchema();
  }
});

// Ensure the database schema is up-to-date
const updateDatabaseSchema = () => {
  db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS email_templates (
      user TEXT,
      name TEXT,
      bodyPath TEXT,
      PRIMARY KEY (user, name)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS contacts (
      user TEXT,
      name TEXT,
      email TEXT,
      PRIMARY KEY (user, email)
    )`);
  });
};

// State management for users
const userStates = {};

// Inline keyboard helper functions
const getMainMenuKeyboard = () => ({
  inline_keyboard: [
    [{ text: 'Configure SMTP', callback_data: 'configure_smtp' }, { text: 'Compose and Send Email', callback_data: 'compose_email' }],
    [{ text: 'Send SMS', callback_data: 'send_sms' }],
    [{ text: 'Manage Templates', callback_data: 'manage_templates' }, { text: 'View SMTP Settings', callback_data: 'view_smtp' }],
    [{ text: 'Test SMTP Connection', callback_data: 'test_smtp' }, { text: 'Help', callback_data: 'help' }, { text: 'Exit', callback_data: 'exit' }],
  ],
});

// Start command
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  initializeSession(chatId);
  bot.sendMessage(chatId, 'Welcome to the Email Bot! Please choose an option:', { reply_markup: getMainMenuKeyboard() });
});

// Function to initialize a new session
const initializeSession = (chatId) => {
  userStates[chatId] = {
    step: null,
    smtp: {},
    email: {
      subject: '',
      body: '',
      bodyPath: '',
      recipients: [],
      attachments: [],
    },
    fromEmails: [],
    senderName: '',
    rateLimit: 1,
    attachmentContentType: '',
    sms: {
      message: '',
      recipients: [],
    },
  };
  console.log(`Initialized session for chat ID: ${chatId}`);
};

// Handle callback queries
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const userState = userStates[chatId];
  const action = query.data;

  if (!userState) {
    await bot.sendMessage(chatId, 'Please start the process using /start.');
    return;
  }

  console.log(`Callback query action: ${action} for chat ID: ${chatId}`);

  switch (action) {
    case 'configure_smtp':
      userState.step = 'enter_smtp_server';
      await bot.sendMessage(chatId, 'Please enter the SMTP server (e.g., smtp.example.com):');
      break;

    case 'compose_email':
      userState.step = 'enter_email_subject';
      await bot.sendMessage(chatId, 'Please enter the email subject:');
      break;

    case 'upload_letter_html':
      userState.step = 'upload_letter_html';
      await bot.sendMessage(chatId, 'Please upload your HTML file for the email body:');
      break;

    case 'enter_email_body_manually':
      userState.step = 'enter_email_body';
      await bot.sendMessage(chatId, 'Please enter the email body:');
      break;

    case 'upload_list_txt':
      userState.step = 'upload_list_txt';
      await bot.sendMessage(chatId, 'Please upload your TXT file:');
      break;

    case 'enter_recipients':
      userState.step = 'enter_recipients';
      await bot.sendMessage(chatId, 'Please enter recipient email addresses separated by commas:');
      break;

    case 'view_smtp':
      viewSmtpSettings(chatId);
      break;

    case 'test_smtp':
      testSmtpConnection(chatId);
      break;

    case 'help':
      await bot.sendMessage(chatId, `How can I assist you? Here are some commands you can use:

- To configure SMTP, choose "Configure SMTP".
- To compose an email, choose "Compose and Send Email".
- To send an SMS, choose "Send SMS".
- To manage templates, choose "Manage Templates".
- To view SMTP settings, choose "View SMTP Settings".
- To test the SMTP connection, choose "Test SMTP Connection".
- To exit, choose "Exit".

You can also type the following commands:
- /start: Restart the bot.
- /done: Indicate you have finished uploading attachments.`);
      break;

    case 'exit':
      await bot.sendMessage(chatId, 'Goodbye!');
      delete userStates[chatId];
      break;

    case 'smtp_port_25':
    case 'smtp_port_587':
    case 'smtp_port_465':
      userState.smtp.port = parseInt(action.replace('smtp_port_', ''), 10);
      userState.step = 'use_tls';
      await bot.sendMessage(chatId, 'Enable TLS?', {
        reply_markup: {
          inline_keyboard: [
            [{ text: 'Yes', callback_data: 'tls_yes' }],
            [{ text: 'No', callback_data: 'tls_no' }],
          ],
        },
      });
      break;

    case 'tls_yes':
      userState.smtp.useTLS = true;
      userState.step = 'enter_smtp_email';
      await bot.sendMessage(chatId, 'Please enter the SMTP email address:');
      break;

    case 'tls_no':
      userState.smtp.useTLS = false;
      userState.step = 'enter_smtp_email';
      await bot.sendMessage(chatId, 'Please enter the SMTP email address:');
      break;

    case 'send_email':
      await sendEmail(chatId);
      break;

    case 'add_attachments':
      userState.step = 'ask_attachment_content_type';
      await bot.sendMessage(chatId, 'Please enter the attachment content type (e.g., text/html, application/pdf):');
      break;

    case 'yes_multiple_from_emails':
      userState.step = 'enter_from_emails';
      await bot.sendMessage(chatId, 'Please enter the "From" emails separated by commas:');
      break;

    case 'no_multiple_from_emails':
      userState.fromEmails = [userState.smtp.email];
      userState.step = 'enter_sender_name';
      await bot.sendMessage(chatId, 'Please enter the sender name:');
      break;

    default:
      break;
  }
});

// Function to view SMTP settings
const viewSmtpSettings = (chatId) => {
  const userState = userStates[chatId];
  bot.sendMessage(chatId, `SMTP Settings:
  Server: ${userState.smtp.server || 'Not set'}
  Port: ${userState.smtp.port || 'Not set'}
  Email: ${userState.smtp.email || 'Not set'}
  Password: ${userState.smtp.password ? '********' : 'Not set'}
  TLS: ${userState.smtp.useTLS !== undefined ? (userState.smtp.useTLS ? 'Enabled' : 'Disabled') : 'Not set'}`);
};

// Handle messages
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;
  const userState = userStates[chatId];

  if (!userState) return;

  console.log(`Message received: ${text} for chat ID: ${chatId} at step: ${userState.step}`);

  switch (userState.step) {
    case 'enter_smtp_server':
      userState.smtp.server = text;
      userState.step = 'enter_smtp_port';
      await bot.sendMessage(chatId, 'Please select the SMTP port or enter manually:', {
        reply_markup: {
          inline_keyboard: [
            [{ text: '25', callback_data: 'smtp_port_25' }],
            [{ text: '587', callback_data: 'smtp_port_587' }],
            [{ text: '465', callback_data: 'smtp_port_465' }],
            [{ text: 'Enter manually', callback_data: 'enter_smtp_port_manual' }],
          ],
        },
      });
      break;

    case 'enter_smtp_port_manual':
      userState.smtp.port = parseInt(text, 10);
      userState.step = 'use_tls';
      await bot.sendMessage(chatId, 'Enable TLS?', {
        reply_markup: {
          inline_keyboard: [
            [{ text: 'Yes', callback_data: 'tls_yes' }],
            [{ text: 'No', callback_data: 'tls_no' }],
          ],
        },
      });
      break;

    case 'enter_smtp_email':
      userState.smtp.email = text;
      userState.step = 'enter_smtp_password';
      await bot.sendMessage(chatId, 'Please enter the SMTP password:');
      break;

    case 'enter_smtp_password':
      userState.smtp.password = text;
      userState.step = null;
      await bot.sendMessage(chatId, 'SMTP configuration saved successfully.', { reply_markup: getMainMenuKeyboard() });
      break;

    case 'enter_email_subject':
      userState.email.subject = text;
      userState.step = 'compose_email_body';
      await bot.sendMessage(chatId, 'Would you like to upload an HTML file for the email body or enter the email body manually?', {
        reply_markup: {
          inline_keyboard: [
            [{ text: 'Upload HTML file', callback_data: 'upload_letter_html' }],
            [{ text: 'Enter email body manually', callback_data: 'enter_email_body_manually' }],
          ],
        },
      });
      break;

    case 'enter_email_body':
      userState.email.body = text;
      userState.step = 'add_recipients_attachments';
      await bot.sendMessage(chatId, 'Email body saved. You can now add recipients and attachments.', {
        reply_markup: {
          inline_keyboard: [
            [{ text: 'Upload TXT file', callback_data: 'upload_list_txt' }],
            [{ text: 'Enter recipients manually', callback_data: 'enter_recipients' }],
          ],
        },
      });
      break;

    case 'enter_recipients':
      userState.email.recipients = text.split(',').map(email => email.trim());
      userState.step = 'enter_rate_limit';
      await bot.sendMessage(chatId, 'Please enter the rate limit (messages per second):');
      break;

    case 'enter_rate_limit':
      userState.rateLimit = parseInt(text, 10);
      userState.step = 'ask_multiple_from_emails';
      await bot.sendMessage(chatId, 'Do you want to use multiple "From" emails? (yes/no)', {
        reply_markup: {
          inline_keyboard: [
            [{ text: 'Yes', callback_data: 'yes_multiple_from_emails' }],
            [{ text: 'No', callback_data: 'no_multiple_from_emails' }],
          ],
        },
      });
      break;

    case 'yes_multiple_from_emails':
      userState.step = 'enter_from_emails';
      await bot.sendMessage(chatId, 'Please enter the "From" emails separated by commas:');
      break;

    case 'no_multiple_from_emails':
      userState.fromEmails = [userState.smtp.email];
      userState.step = 'enter_sender_name';
      await bot.sendMessage(chatId, 'Please enter the sender name:');
      break;

    case 'enter_from_emails':
      userState.fromEmails = text.split(',').map(email => email.trim());
      userState.step = 'enter_sender_name';
      await bot.sendMessage(chatId, 'Please enter the sender name:');
      break;

    case 'enter_sender_name':
      userState.senderName = text;
      userState.step = 'confirm_send_email';
      await bot.sendMessage(chatId, 'Would you like to send the email now?', {
        reply_markup: {
          inline_keyboard: [
            [{ text: 'Yes, send email', callback_data: 'send_email' }],
            [{ text: 'No, add attachments', callback_data: 'add_attachments' }],
          ],
        },
      });
      break;

    default:
      if (userState.step === 'ask_attachment_content_type') {
        userState.attachmentContentType = text;
        userState.step = 'add_attachments';
        await bot.sendMessage(chatId, 'Please attach any files (max 3MB):', {
          reply_markup: {
          },
        });
      }
      break;
  }
});

// Handle document uploads
bot.on('document', async (msg) => {
  const chatId = msg.chat.id;
  const userState = userStates[chatId];

  if (!userState) return;

  const fileId = msg.document.file_id;
  const fileName = msg.document.file_name;
  const filePath = path.join(uploadsDir, fileName);

  try {
    const fileStream = bot.getFileStream(fileId);
    const fileWriteStream = fs.createWriteStream(filePath);
    fileStream.pipe(fileWriteStream);

    fileWriteStream.on('finish', async () => {
      if (userState.step === 'upload_letter_html') {
        userState.email.bodyPath = filePath;
        userState.step = 'add_recipients_attachments';
        await bot.sendMessage(chatId, 'HTML file uploaded successfully. You can now add recipients and attachments.', {
          reply_markup: {
            inline_keyboard: [
              [{ text: 'Upload TXT file', callback_data: 'upload_list_txt' }],
              [{ text: 'Enter recipients manually', callback_data: 'enter_recipients' }],
            ],
          },
        });
      } else if (userState.step === 'upload_list_txt') {
        const fileContent = await fsp.readFile(filePath, 'utf8');
        userState.email.recipients = fileContent.split('\n').map(email => email.trim());
        userState.step = 'enter_rate_limit';
        await bot.sendMessage(chatId, 'TXT file uploaded successfully. Please enter the rate limit (messages per second):');
      } else if (userState.step === 'add_attachments') {
        const fileContent = await fsp.readFile(filePath, 'utf8');
        const updatedContent = replacePlaceholders(fileContent, userState.email.recipients[0]);
        await fsp.writeFile(filePath, updatedContent);

        userState.email.attachments.push({
          path: filePath,
          filename: replacePlaceholders(fileName, userState.email.recipients[0]),
          contentType: userState.attachmentContentType,
        });
        await bot.sendMessage(chatId, 'Attachment added successfully.', {
          reply_markup: {
            inline_keyboard: [
              [{ text: 'Send emails', callback_data: 'send_email' }],
              [{ text: 'Add more attachments', callback_data: 'add_attachments' }],
            ],
          },
        });
      }
    });

    fileWriteStream.on('error', async (error) => {
      console.error('Error downloading file:', error);
      await bot.sendMessage(chatId, 'Failed to download the file. Please try again.');
    });
  } catch (error) {
    console.error('Error handling file upload:', error);
    await bot.sendMessage(chatId, 'An error occurred while handling the file upload. Please try again.');
  }
});

// Handle sending email
const sendEmail = async (chatId) => {
  const userState = userStates[chatId];
  const { server, port, email, password, useTLS } = userState.smtp;
  const { subject, body, bodyPath, recipients, attachments } = userState.email;

  const placeholders = {}; // Placeholder object; replace with actual data source

  const missingFields = [];

  if (!server) missingFields.push('SMTP server');
  if (!port) missingFields.push('SMTP port');
  if (!email) missingFields.push('SMTP email');
  if (!password) missingFields.push('SMTP password');
  if (!body && !bodyPath) missingFields.push('Email body or HTML file');
  if (!recipients.length) missingFields.push('Recipients');

  if (missingFields.length) {
    bot.sendMessage(chatId, `Incomplete email details. Please make sure all fields are filled: ${missingFields.join(', ')}.`);
    return;
  }

  const transporter = nodemailer.createTransport({
    host: server,
    port: port,
    secure: useTLS,
    auth: {
      user: email,
      pass: password,
    },
  });

  try {
    for (const recipient of recipients) {
      const mailOptions = {
        from: `"${replacePlaceholders(userState.senderName, recipient)}" <${replacePlaceholders(userState.fromEmails[Math.floor(Math.random() * userState.fromEmails.length)], recipient)}>`,
        to: recipient,
        subject: replacePlaceholders(subject, recipient),
        text: body ? replacePlaceholders(body, recipient) : '',
        html: bodyPath ? replacePlaceholders(await fsp.readFile(bodyPath, 'utf8'), recipient) : '',
        attachments: attachments.map((attachment) => ({
          filename: replacePlaceholders(attachment.filename, recipient),
          path: attachment.path,
          contentType: attachment.contentType,
        })),
      };

      await transporter.sendMail(mailOptions);
      await bot.sendMessage(chatId, `Email sent successfully to ${recipient}.`);

      if (userState.rateLimit > 0) {
        await new Promise(resolve => setTimeout(resolve, 1000 / userState.rateLimit));
      }
    }
  } catch (error) {
    bot.sendMessage(chatId, `Failed to send email: ${error.message}`);
  }
};

// Function to test SMTP connection
const testSmtpConnection = async (chatId) => {
  const userState = userStates[chatId];
  const { server, port, email, password, useTLS } = userState.smtp;

  if (!server || !port || !email || !password) {
    bot.sendMessage(chatId, 'Incomplete SMTP details. Please configure SMTP settings properly.');
    return;
  }

  const transporter = nodemailer.createTransport({
    host: server,
    port: port,
    secure: useTLS,
    auth: {
      user: email,
      pass: password,
    },
  });

  try {
    await transporter.verify();
    bot.sendMessage(chatId, 'SMTP connection successful.');
  } catch (error) {
    bot.sendMessage(chatId, `SMTP connection failed: ${error.message}`);
  }
};

// Error handling
bot.on('polling_error', (error) => {
  console.error('Polling error:', error);
});

console.log('Bot is running...');
