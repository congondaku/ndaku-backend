// debug-twilio.js - Run this to test your Twilio credentials
const twilio = require("twilio");
require("dotenv").config();

async function debugTwilioCredentials() {
  console.log("🔍 Debugging Twilio Credentials...\n");

  // Check environment variables
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const whatsappNumber = process.env.TWILIO_WHATSAPP_NUMBER;

  console.log("📋 Environment Variables:");
  console.log(
    "TWILIO_ACCOUNT_SID:",
    accountSid ? `${accountSid.substring(0, 10)}...` : "NOT SET"
  );
  console.log(
    "TWILIO_AUTH_TOKEN:",
    authToken ? `${authToken.substring(0, 10)}...` : "NOT SET"
  );
  console.log("TWILIO_WHATSAPP_NUMBER:", whatsappNumber || "NOT SET");
  console.log("");

  if (!accountSid || !authToken) {
    console.log("❌ Missing Twilio credentials in environment variables");
    return;
  }

  // Test credentials
  console.log("🧪 Testing Twilio Credentials...");
  try {
    const client = twilio(accountSid, authToken);

    // Try to fetch account info
    const account = await client.api.accounts(accountSid).fetch();

    console.log("✅ Credentials Valid!");
    console.log("Account Status:", account.status);
    console.log("Account Type:", account.type);
    console.log("Account SID:", account.sid);
    console.log("Date Created:", account.dateCreated);

    // Test WhatsApp capabilities
    console.log("\n📱 Testing WhatsApp Service...");

    // Check if sandbox is set up
    try {
      const messages = await client.messages.list({ limit: 1 });
      console.log("✅ Messaging service accessible");

      // Try sending a test message to the sandbox number (this will fail but show us the error)
      console.log("\n🧪 Testing WhatsApp Message Sending...");
      try {
        await client.messages.create({
          body: "Test message from Ndaku",
          from: whatsappNumber || "whatsapp:+14155238886",
          to: "whatsapp:+1234567890", // This will fail intentionally
        });
      } catch (testError) {
        console.log(
          "Expected test error:",
          testError.code,
          "-",
          testError.message
        );

        if (testError.code === 21608) {
          console.log(
            "ℹ️  This is normal - you need to join the WhatsApp sandbox first"
          );
        } else if (testError.code === 21211) {
          console.log("ℹ️  This is normal - invalid test number");
        }
      }
    } catch (error) {
      console.log("❌ Error accessing messaging service:", error.message);
    }
  } catch (error) {
    console.log("❌ Credential Test Failed:");
    console.log("Error Code:", error.code);
    console.log("Error Message:", error.message);

    if (error.code === 20003) {
      console.log("\n🔧 Troubleshooting Tips:");
      console.log(
        "1. Verify your Account SID and Auth Token in Twilio Console"
      );
      console.log("2. Check if your Twilio account is active (not suspended)");
      console.log(
        "3. Ensure you're using the correct credentials (not test credentials)"
      );
      console.log("4. Try regenerating your Auth Token in Twilio Console");
    }
  }
}

// Also create a simplified WhatsApp service for testing
async function testWhatsAppMessage(phoneNumber) {
  console.log(`\n📤 Testing WhatsApp message to ${phoneNumber}...`);

  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const whatsappNumber =
    process.env.TWILIO_WHATSAPP_NUMBER || "whatsapp:+14155238886";

  try {
    const client = twilio(accountSid, authToken);

    const result = await client.messages.create({
      body: "🔐 *Test from Ndaku*\n\nYour verification code is: *123456*\n\nThis is a test message.",
      from: whatsappNumber,
      to: `whatsapp:${phoneNumber}`,
    });

    console.log("✅ Message sent successfully!");
    console.log("Message SID:", result.sid);
    console.log("Status:", result.status);
  } catch (error) {
    console.log("❌ Failed to send message:");
    console.log("Error Code:", error.code);
    console.log("Error Message:", error.message);

    // Provide specific guidance based on error
    switch (error.code) {
      case 21608:
        console.log("\n💡 Solution: Join the WhatsApp Sandbox");
        console.log(
          "1. Go to Twilio Console > Messaging > Try it out > Send a WhatsApp message"
        );
        console.log('2. Send "join <sandbox-keyword>" to +1 415 523 8886');
        console.log("3. Wait for confirmation, then try again");
        break;

      case 63016:
        console.log("\n💡 The phone number is not registered on WhatsApp");
        break;

      case 21211:
        console.log(
          "\n💡 Invalid phone number format - ensure it includes country code"
        );
        break;

      case 20003:
        console.log(
          "\n💡 Authentication failed - check your Twilio credentials"
        );
        break;
    }
  }
}

// Run the debug
debugTwilioCredentials()
  .then(() => {
    console.log("\n🏁 Debug complete!");

    // Optionally test with a specific phone number
    const testPhone = process.argv[2];
    if (testPhone) {
      return testWhatsAppMessage(testPhone);
    }
  })
  .catch(console.error);

// Usage: node debug-twilio.js [optional-phone-number-to-test]
