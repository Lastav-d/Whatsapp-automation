require('dotenv').config();

function required(name) {
  const value = process.env[name];
  if (!value) {
    // We don't throw here at import-time for every var (so `npm start` gives
    // one clean error instead of crashing on the first missing var during
    // early local setup) — but we do warn loudly.
    console.warn(`⚠️  Missing environment variable: ${name}`);
  }
  return value;
}

module.exports = {
  port: process.env.PORT || 3000,

  whatsapp: {
    verifyToken: required('WHATSAPP_VERIFY_TOKEN'),
    appSecret: required('WHATSAPP_APP_SECRET'),
    accessToken: required('WHATSAPP_ACCESS_TOKEN'),
    phoneNumberId: required('WHATSAPP_PHONE_NUMBER_ID'),
    graphApiVersion: process.env.WHATSAPP_GRAPH_API_VERSION || 'v20.0',
    flowId: process.env.WHATSAPP_FLOW_ID || '',
  },
  supabase: {
    url: required('SUPABASE_URL'),
    key: required('SUPABASE_KEY'),
  },
};
