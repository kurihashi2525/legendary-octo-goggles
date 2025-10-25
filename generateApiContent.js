// functions/generateApiContent.js
// Using standard exports.handler syntax for Netlify Lambda Functions

// Node's built-in stream module (required for TransformStream in this environment)
import { TransformStream } from 'node:stream/web'; 
// node-fetch is needed in standard functions
import fetch from 'node-fetch'; 

// Helper to transform Google's stream format
const createTransformStream = () => {
  return new TransformStream({
    transform(chunk, controller) {
      const text = new TextDecoder().decode(chunk);
      const lines = text.split('\n');
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          controller.enqueue(new TextEncoder().encode(line.substring(6)));
        }
      }
    }
  });
};

exports.handler = async function(event, context) {
  try {
    // Get request body from the event object
    const requestBody = JSON.parse(event.body || '{}'); 
    const apiKey = process.env.GOOGLE_API_KEY;

    // Google AI streaming endpoint
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:streamGenerateContent?key=${apiKey}`;

    // Make the streaming request to Google
    const geminiResponse = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    if (!geminiResponse.ok || !geminiResponse.body) {
      const errorBody = await geminiResponse.text();
      throw new Error(`Google API Error: ${geminiResponse.status} ${errorBody}`);
    }

    // Transform the stream
    const transformStream = createTransformStream();
    const readableStream = geminiResponse.body.pipeThrough(transformStream);

    // Return the stream as the response body for Netlify
    return {
      statusCode: 200,
      headers: { 
        'Content-Type': 'application/json',
        'Transfer-Encoding': 'chunked' // Indicate streaming
      },
      body: readableStream, // Pass the ReadableStream directly
      isBase64Encoded: false
    };

  } catch (error) {
    console.error("Netlify Function Error:", error);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: error.message }),
    };
  }
};