const config = require('../config');
const { processConversation } = require('../automation/processConversation');
const db = require('../services/supabase');
const whatsapp = require('../services/whatsapp');
const logger = require('../utils/logger');

/**
 * Safely parses the JSON `data` blob stored on the master row / process
 * output. Mirrors the `JSON.parse(x || "{}")` pattern used throughout the
 * original n8n expressions.
 */
function safeParseData(jsonString) {
  try {
    return JSON.parse(jsonString || '{}');
  } catch {
    return {};
  }
}

/**
 * Equivalent of "BookVehicleGetRows" -> "BookVehicleAppendUpdateRow".
 * Each field prefers the freshly-collected value from this turn's `data`,
 * falling back to whatever was already in the BookVehicle sheet row.
 */
async function persistBookVehicle(output) {
  const data = safeParseData(output.data);
  const existing = await db.getBookVehicleRow(output.user_id);

  const row = {
    user_id: output.user_id,
    state: output.state,
    updated_at: output.updated_at,
    loadingPin: data.loadingPin || existing.loadingPin || '',
    unloadingPin: data.unloadingPin || existing.unloadingPin || '',
    cargoType: data.cargoType || existing.cargoType || '',
    vehicleType: data.vehicleType || existing.vehicleType || '',
    vehicleSubType: data.vehicleSubType || existing.vehicleSubType || '',
    material: data.material || existing.material || '',
    loadingDate: data.loadingDate || existing.loadingDate || '',
    company: data.company || existing.company || '',
    contactName: data.contactName || existing.contactName || '',
    phone: data.phone || existing.phone || '',
    email: data.email || existing.email || '',
    website: data.website || existing.website || '',
  };

  await db.saveBookVehicleRow(row);
}

/**
 * Equivalent of "ProvideVehicleGetRows" -> "ProvideVehicleAppendUpdateRow1".
 *
 * NOTE: the original n8n node mapped the "notes" column from
 * `provider_capacity` instead of `provider_notes` — almost certainly a
 * copy-paste bug in the source workflow. We replicate it as-is here for
 * exact functional parity; flip the line below to `data.provider_notes`
 * once you've confirmed with the business which behavior is correct.
 */
async function persistProvideVehicle(output) {
  const data = safeParseData(output.data);
  const existing = await db.getProvideVehicleRow(output.user_id);

  const row = {
    user_id: output.user_id,
    state: output.state,
    updated_at: output.updated_at,
    vehicleType: data.provider_vehicleType || existing.vehicleType || '',
    vehicleNumber: data.provider_vehicleNumber || existing.vehicleNumber || '',
    driverName: data.provider_driverName || existing.driverName || '',
    capacity: data.provider_capacity || existing.capacity || '',
    routePreference: data.provider_routes || existing.routePreference || '',
    availability: data.provider_availability || existing.availability || '',
    driverPhone: data.provider_driverPhone || existing.driverPhone || '',
    currentLocation: data.provider_currentLocation || existing.currentLocation || '',
    // Replicated from original workflow — see NOTE above.
    notes: data.provider_capacity || existing.notes || '',
    documents: data.provider_documents || existing.documents || '',
  };

  await db.saveProvideVehicleRow(row);
}

/** Equivalent of "SupportGetRows" -> "SupportAppendUpdateRow". */
async function persistSupport(output) {
  await db.saveSupportRow({
    user_id: output.user_id,
    updated_at: output.updated_at,
  });
}

/**
 * Equivalent of the n8n "Switch" node (branch on flowType) feeding into
 * the per-flow sheet + the shared "Send message1-summary" node.
 */
async function persistToFlowSheet(output) {
  switch (output.flowType) {
    case 'book':
      return persistBookVehicle(output);
    case 'provider':
      return persistProvideVehicle(output);
    case 'support':
      return persistSupport(output);
    default:
      // Matches the Switch node's fallback output — no sheet write, just send the reply.
      return null;
  }
}

/**
 * Main entrypoint — equivalent of the full chain:
 * WhatsApp Trigger -> Get Master Row -> Process Conversation ->
 * Save Master Session -> Switch -> [flow sheet] -> Send message -> If1 -> HTTP Request
 *
 * @param {object} value - `entry[0].changes[0].value` from Meta's webhook body
 */
async function handleIncomingMessage(value) {
  // Meta sends "status" updates (delivered/read receipts) through the same
  // webhook — the original workflow only ever handled `.messages`, so we
  // skip anything that isn't an actual inbound message.
  if (!value?.messages?.length) {
    logger.info('Webhook payload had no messages (likely a status update) — skipping');
    return;
  }

  const phone = value.messages[0]?.from;

  // "Get Master Row" — exact phone match against users_master
  const masterRows = phone ? await db.getMasterRowsByPhone(phone) : [];

  // "Process Conversation"
  const output = processConversation(value, masterRows);

  // "Save Master Session"
  await db.saveMasterSession(output);

  // "Switch" -> per-flow sheet upsert
  await persistToFlowSheet(output);

  // "Send message1-summary" (or Flow calendar if state is loading_date and flowId configured)
  if (output.state === 'loading_date' && config.whatsapp.flowId) {
    try {
      await whatsapp.sendFlowDatePicker(output.phone, config.whatsapp.flowId);
    } catch (flowErr) {
      logger.warn('Failed to send WhatsApp Flow DatePicker, falling back to text', flowErr);
      await whatsapp.sendText(output.phone, output.response);
    }
  } else if (output.response) {
    await whatsapp.sendText(output.phone, output.response);
  }

  // "If1" -> "HTTP Request" (CTA buttons shown after a flow completes)
  if (output.state === 'cta_menu') {
    await whatsapp.sendCtaButtons(output.phone);
  }

  logger.info('Processed message', { phone: output.phone, state: output.state, flowType: output.flowType });
}

module.exports = { handleIncomingMessage };
