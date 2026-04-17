const jwt = require('jsonwebtoken');
const fs = require('fs');

// 1. Update this to the exact name of your downloaded .p8 file
const privateKey = fs.readFileSync('AuthKey_H8B73JA2K8.p8');

const token = jwt.sign({
  iss: '3F6HFR6XWL',             // Apple Team ID
  iat: Math.floor(Date.now() / 1000),      // Issued at (Now)
  exp: Math.floor(Date.now() / 1000) + (86400 * 180), // Expires in exactly 6 months
  aud: 'https://appleid.apple.com',
  sub: 'com.contentredact.web'             // The Client ID from your Supabase setup
}, privateKey, {
  algorithm: 'ES256',
  keyid: 'H8B73JA2K8'             // The Key ID for the .p8 file
});

console.log("\n--- YOUR APPLE JWT SECRET KEY ---");
console.log(token);
console.log("---------------------------------\n");