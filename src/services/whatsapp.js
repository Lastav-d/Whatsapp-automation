const config = require('../config');
const logger = require('../utils/logger');

function graphUrl() {
  return `https://graph.facebook.com/${config.whatsapp.graphApiVersion}/${config.whatsapp.phoneNumberId}/messages`;
}

async function callGraphApi(body) {
  const res = await fetch(graphUrl(), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.whatsapp.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    logger.error('WhatsApp Graph API call failed', { status: res.status, data });
    throw new Error(`WhatsApp API error (${res.status}): ${JSON.stringify(data)}`);
  }

  return data;
}

/**
 * Equivalent of the n8n "Send message1-summary" WhatsApp node —
 * sends a plain text reply.
 */
async function sendText(to, text) {
  return callGraphApi({
    messaging_product: 'whatsapp',
    to,
    type: 'text',
    text: { body: text },
  });
}

/**
 * Equivalent of the n8n "HTTP Request" node — sends the 3-button
 * interactive CTA menu shown after a flow completes (state === "cta_menu").
 */
async function sendCtaButtons(to) {
  return callGraphApi({
    messaging_product: 'whatsapp',
    to,
    type: 'interactive',
    interactive: {
      type: 'button',
      body: { text: '👉 What would you like to do next?' },
      action: {
        buttons: [
          { type: 'reply', reply: { id: 'cta_new', title: 'Post New Order' } },
          { type: 'reply', reply: { id: 'cta_ai', title: 'Know About Traket' } },
          { type: 'reply', reply: { id: 'cta_support', title: 'Support' } },
        ],
      },
    },
  });
}

/**
 * Sends a native WhatsApp Flow with in-app DatePicker calendar.
 */
async function sendFlowDatePicker(to, flowId, minDate) {
  const today = minDate || new Date().toISOString().split('T')[0];
  return callGraphApi({
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'interactive',
    interactive: {
      type: 'flow',
      header: {
        type: 'text',
        text: '📅 Loading Date',
      },
      body: {
        text: 'Tap below to open the calendar and choose your vehicle loading date:',
      },
      footer: {
        text: 'Traket Transport',
      },
      action: {
        name: 'flow',
        parameters: {
          flow_message_version: '3',
          flow_token: `flow_${to}_${Date.now()}`,
          flow_id: flowId,
          flow_cta: '📅 Select Date',
          flow_action: 'navigate',
          flow_action_payload: {
            screen: 'DATE_SELECTION',
            data: {
              min_date: today,
            },
          },
        },
      },
    },
  });
}

module.exports = { sendText, sendCtaButtons, sendFlowDatePicker };
