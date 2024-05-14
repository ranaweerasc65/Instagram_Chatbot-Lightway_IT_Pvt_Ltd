require("dotenv").config();

const express = require("express");
const bodyParser = require("body-parser");
const serverless = require("serverless-http");
const request = require("request");

const MY_VERIFY_TOKEN = process.env.MY_VERIFY_TOKEN;
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;


const app = express();

app.use(express.json());

// Configuration of body-parser
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

const AWS = require('aws-sdk');
AWS.config.update({ region: 'ap-southeast-1' });
const lambda = new AWS.Lambda();

let msgPlatform="Instagram";
let messageCounter = 0;



app.get("/", (req, res) => {
  return res.send("root");
});

// Token verification for callback URL
app.get("/webhook", (req, res) => {
  let VERIFY_TOKEN = MY_VERIFY_TOKEN;

  let mode = req.query["hub.mode"];
  let token = req.query["hub.verify_token"];
  let challenge = req.query["hub.challenge"];

  if (mode && token) {
    if (mode === "subscribe" && token === VERIFY_TOKEN) {
      console.log("Webhook Verified");
      res.status(200).send(challenge);
    } else {
      res.sendStatus(403);
    }
  }
});

// When an Instagram account sends a message to the page
app.post("/webhook", async (req, res) => {
  console.log(JSON.stringify(req.body, null, 2)); // Log the body with pretty print
  let body = req.body;
  // Check the webhook event is from an Instagram subscription
  if (body.object === "instagram") {
    // Iterate over each entry - there may be multiple if batched
    body.entry.forEach(async function (entry) {
      // Gets the body of the webhook event
      let webhook_event = entry.messaging[0];
      console.log(JSON.stringify(webhook_event, null, 2)); // Log the webhook event with pretty print

      // Get the sender IGSID
      let sender_igsid = webhook_event.sender.id;
      console.log("Sender IGSID: " + sender_igsid);

      // Get the recipient IGSID
      let recipient_igsid = webhook_event.recipient.id;
      console.log("Recipient IGSID: " + recipient_igsid);
      
      // Get the original msg_id
      let originalMsgId = webhook_event.message.mid;
      console.log("originalMsgId: " + originalMsgId);
      
      // Generate the new msg_id format (e.g., ig_001_mid, ig_002_mid, etc.)
      let newMsgId = `ig_${String(messageCounter).padStart(3, "0")}_${originalMsgId}`;

      // Update the counter for the next message
      messageCounter++;
      // Retrieve the user's name
      retrieveUserName(sender_igsid, (userName) => {
        // Check if the event is a message or postback and
        // pass the event to the appropriate handler function
        if (webhook_event.message) {
          handleMessage(sender_igsid, webhook_event.message, userName, recipient_igsid, entry.time,newMsgId);
        } else if (webhook_event.postback) {
          handlePostback(sender_igsid, webhook_event.postback, recipient_igsid);
        }
      });
    });
  } else {
    // Return a '404 Not Found' if the event is not from an Instagram subscription
    res.status(404).json("Problem with the request body");
  }
});

// Function to retrieve user's name using the Facebook Graph API
function retrieveUserName(sender_igsid, callback) {
  request(
    {
      uri: `https://graph.facebook.com/v18.0/${sender_igsid}`,
      qs: {
        access_token: PAGE_ACCESS_TOKEN,
        fields: "first_name",
      },
      method: "GET",
    },
    (err, res, body) => {
      if (!err) {
        const user = JSON.parse(body);
        const userName = user.first_name;
        callback(userName);
      } else {
        console.error("Error retrieving user's name: " + err);
        callback("User");
      }
    }
  );
}

async function handleMessage(sender_igsid, received_message, userName, recipient_igsid, timestamp,newMsgId) {
  
  
  //let msgPlatform="Instagram";
  //msgPlatform:msgPlatform
  
  if (received_message.text) {
    try {
      const childLambdaParams = {
        // FunctionName: 'testChildLmbda',
         FunctionName: 'Assistant-chatbot-node',
       
        InvocationType: 'RequestResponse',
        Payload: JSON.stringify({
          msg_body: received_message.text,
          fromNo: sender_igsid,
          timestamp: timestamp,
          display_phone_number: recipient_igsid,
          //msg_id: received_message.mid,
          msg_id: newMsgId, // Use the new msg_id format
          msgPlatform:msgPlatform
        }),
      };

      const childLambdaResponse = await lambda.invoke(childLambdaParams).promise();
      const childReply = JSON.parse(childLambdaResponse.Payload);
      
      // For other messages, reply with a single message
      sendTextMessage(sender_igsid, childReply, recipient_igsid, timestamp, received_message.mid);
    } catch (error) {
      console.error("Error invoking Assistant-chatbot-node:", error);
    }
  } else if (received_message.attachments) {
    // Handle attachments as before
    let attachment_url = received_message.attachments[0].payload.url;

    let response = {
      attachment: {
        type: "template",
        payload: {
          template_type: "generic",
          elements: [
            {
              title: "Is this the right picture?",
              subtitle: "Tap a button to answer.",
              image_url: attachment_url,
              buttons: [
                {
                  type: "postback",
                  title: "Yes!",
                  payload: "yes",
                },
                {
                  type: "postback",
                  title: "No!",
                  payload: "no",
                },
              ],
            },
          ],
        },
      },
    };

    callSendAPI(sender_igsid, response, recipient_igsid, timestamp, newMsgId);
  }
}

// Send a text message
function sendTextMessage(sender_igsid, text, recipient_igsid, timestamp, msg_id) {
  let response = {
    text,
  };
  callSendAPI(sender_igsid, response, recipient_igsid, timestamp, msg_id);
}

// Handles postbacks events
function handlePostback(sender_igsid, received_postback, recipient_igsid) {
  let response;

  // Handle postbacks as needed

  // Send the message to acknowledge the postback
  callSendAPI(sender_igsid, response, recipient_igsid);
}

// Sends response messages via the Send API
async function callSendAPI(sender_igsid, response, recipient_igsid, timestamp, msg_id,received_message) {
  // Construct the message body
  let request_body = {
    recipient: {
      id: sender_igsid,
    },
    message: response,
  };

  // Send the HTTP request to the Instagram Messaging Platform
  request(
    {
      uri: "https://graph.facebook.com/v18.0/me/messages",
      qs: { access_token: PAGE_ACCESS_TOKEN },
      method: "POST",
      json: request_body,
    },
    async (err, res, body) => {
      if (!err) {
        console.log("Message sent!");
        // Now, invoke the 'Assistant-chatbot-node' Lambda function
        const childLambdaParams = {
          FunctionName: 'Assistant-chatbot-node',
          InvocationType: 'RequestResponse',
          Payload: JSON.stringify({
            msg_body: response.text,
            //msg_body: received_message.text,
            fromNo: sender_igsid,
            timestamp: timestamp,
            display_phone_number: recipient_igsid,
            msg_id: msg_id,
            msgPlatform:msgPlatform
            
            
          
          }),
        };

        try {
          const childLambdaResponse = await lambda.invoke(childLambdaParams).promise();
          const childReply = JSON.parse(childLambdaResponse.Payload);
          console.log("Assistant-chatbot-node response:", childReply);
        } catch (error) {
          console.error("Error invoking Assistant-chatbot-node:", error);
        }
      } else {
        console.error("Unable to send message: " + err);
      }
    }
  );
}

module.exports.handler = serverless(app);
