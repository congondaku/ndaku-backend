// debug-twilio-standalone.js
// Run this with: node debug-twilio-standalone.js

const dotenv = require('dotenv');
const path = require('path');

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, './.env') });

async function debugTwilioCredentials() {
    console.log('🔍 Debugging Twilio Credentials...\n');
    
    // Check environment variables
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const whatsappNumber = process.env.TWILIO_WHATSAPP_NUMBER;
    
    console.log('📋 Environment Variables:');
    console.log('TWILIO_ACCOUNT_SID:', accountSid ? `${accountSid.substring(0, 10)}...` : '❌ NOT SET');
    console.log('TWILIO_AUTH_TOKEN:', authToken ? `${authToken.substring(0, 10)}...` : '❌ NOT SET');
    console.log('TWILIO_WHATSAPP_NUMBER:', whatsappNumber || '⚠️  Using default sandbox');
    console.log('');
    
    if (!accountSid || !authToken) {
        console.log('❌ Missing Twilio credentials in environment variables');
        console.log('Make sure your .env file contains:');
        console.log('TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxx');
        console.log('TWILIO_AUTH_TOKEN=xxxxxxxxxxxxxxxxxxxxxxx');
        return;
    }
    
    console.log('🧪 Testing Twilio Credentials with curl...');
    
    // Test with curl command
    const curlCommand = `curl -X GET "https://api.twilio.com/2010-04-01/Accounts/${accountSid}.json" \\\n  -u ${accountSid}:${authToken}`;
    console.log('Running equivalent of:', curlCommand);
    console.log('');
    
    // Test credentials with Twilio SDK
    console.log('🔌 Testing with Twilio SDK...');
    try {
        const twilio = require('twilio');
        const client = twilio(accountSid, authToken);
        
        // Try to fetch account info
        const account = await client.api.accounts(accountSid).fetch();
        
        console.log('✅ Credentials are VALID!');
        console.log('📊 Account Details:');
        console.log('  - Account SID:', account.sid);
        console.log('  - Status:', account.status);
        console.log('  - Type:', account.type);
        console.log('  - Date Created:', account.dateCreated);
        console.log('  - Friendly Name:', account.friendlyName || 'Not set');
        
        if (account.status !== 'active') {
            console.log('⚠️  WARNING: Account status is not "active"');
            console.log('   This could be why authentication is failing.');
        }
        
        // Test messaging capability
        console.log('\n📱 Testing Messaging Service...');
        try {
            const messages = await client.messages.list({ limit: 1 });
            console.log('✅ Messaging service is accessible');
            console.log(`   Found ${messages.length} recent message(s)`);
        } catch (msgError) {
            console.log('❌ Messaging service error:', msgError.message);
        }
        
        return true;
        
    } catch (error) {
        console.log('❌ Credential Test FAILED:');
        console.log('   Error Code:', error.code || 'Unknown');
        console.log('   Error Message:', error.message);
        console.log('   Status:', error.status || 'Unknown');
        
        // Provide specific troubleshooting
        switch (error.code) {
            case 20003:
                console.log('\n🔧 TROUBLESHOOTING for Error 20003:');
                console.log('1. ✓ Verify Account SID in Twilio Console');
                console.log('2. ✓ Verify Auth Token in Twilio Console (click eye icon to reveal)');
                console.log('3. ✓ Check if account is suspended or deactivated');
                console.log('4. ✓ Try regenerating the Auth Token');
                console.log('5. ✓ Make sure there are no extra spaces or characters');
                break;
                
            case 20005:
                console.log('\n🔧 TROUBLESHOOTING for Error 20005:');
                console.log('1. Account SID format is invalid');
                console.log('2. Should start with "AC" followed by 32 characters');
                break;
                
            default:
                console.log('\n🔧 GENERAL TROUBLESHOOTING:');
                console.log('1. Check Twilio Console for account status');
                console.log('2. Verify credentials are for the correct project');
                console.log('3. Ensure account has sufficient balance');
        }
        
        return false;
    }
}

// Test WhatsApp message sending (if credentials are valid)
async function testWhatsAppMessage(phoneNumber) {
    console.log(`\n📤 Testing WhatsApp message to ${phoneNumber}...`);
    
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const whatsappNumber = process.env.TWILIO_WHATSAPP_NUMBER || 'whatsapp:+14155238886';
    
    try {
        const twilio = require('twilio');
        const client = twilio(accountSid, authToken);
        
        const result = await client.messages.create({
            body: '🧪 Test from Ndaku\n\nYour verification code is: *123456*\n\nThis is a test message.',
            from: whatsappNumber,
            to: `whatsapp:${phoneNumber}`
        });
        
        console.log('✅ Message sent successfully!');
        console.log('   Message SID:', result.sid);
        console.log('   Status:', result.status);
        console.log('   To:', result.to);
        console.log('   From:', result.from);
        
    } catch (error) {
        console.log('❌ Failed to send WhatsApp message:');
        console.log('   Error Code:', error.code);
        console.log('   Error Message:', error.message);
        
        // Provide specific guidance based on error
        switch (error.code) {
            case 21608:
                console.log('\n💡 SOLUTION: Join the WhatsApp Sandbox');
                console.log('1. Go to Twilio Console > Messaging > Try it out > Send a WhatsApp message');
                console.log('2. Send "join <sandbox-keyword>" to +1 415 523 8886');
                console.log('3. Wait for confirmation, then try again');
                break;
                
            case 63016:
                console.log('\n💡 The phone number is not registered on WhatsApp');
                break;
                
            case 21211:
                console.log('\n💡 Invalid phone number format');
                console.log('   Ensure it includes country code (+1234567890)');
                break;
                
            case 20003:
                console.log('\n💡 Authentication failed - check your Twilio credentials');
                break;
                
            case 21606:
                console.log('\n💡 WhatsApp message template not approved');
                break;
        }
    }
}

// Main execution
async function main() {
    try {
        const credentialsValid = await debugTwilioCredentials();
        
        // If credentials are valid and user provided a phone number, test messaging
        const testPhone = process.argv[2];
        if (credentialsValid && testPhone) {
            await testWhatsAppMessage(testPhone);
        } else if (credentialsValid && !testPhone) {
            console.log('\n💡 To test WhatsApp messaging, run:');
            console.log('   node debug-twilio-standalone.js +1234567890');
        }
        
    } catch (error) {
        console.error('❌ Debug script failed:', error.message);
    }
    
    console.log('\n🏁 Debug complete!');
}

// Handle missing twilio package
try {
    require('twilio');
    main();
} catch (error) {
    if (error.code === 'MODULE_NOT_FOUND') {
        console.log('❌ Twilio package not found. Install it with:');
        console.log('   npm install twilio');
    } else {
        console.error('❌ Error:', error.message);
    }
}