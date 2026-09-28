/**
 * This is a faithful port of the n8n "Process Conversation" Code node.
 * Every state, every response string, and every branch condition is kept
 * identical to the original so bot behavior does not change during migration.
 *
 * Differences from the original n8n node (input/output plumbing only):
 *   - n8n's `$node["WhatsApp Trigger3"].json`  -> the `waMessagePayload` param
 *   - n8n's `$input.all()` (rows from "Get Master Row") -> the `masterRows` param
 *   - n8n returned `[{ json: output }]`        -> this function returns `output` directly
 *
 * @param {object} waMessagePayload - the raw WhatsApp webhook "value" object,
 *   i.e. `entry[0].changes[0].value` from Meta's webhook payload. Expected to
 *   have a `.messages` array like n8n's WhatsApp Trigger node produced.
 * @param {object[]} masterRows - rows from users_master sheet already
 *   filtered by exact phone match (equivalent of "Get Master Row" output).
 *   Each element should be the plain row object (not wrapped in `{json}`).
 * @returns {object} output - the same shape the n8n node wrote to
 *   users_master: { user_id, phone, state, updated_at, response, flowType, data }
 */
function processConversation(waMessagePayload, masterRows) {
  // ================= SAFE INPUT =================
  const chat = waMessagePayload || {};

  let rawMessage = '';
  const msg = chat.messages?.[0];

  if (msg?.type === 'text') {
    rawMessage = msg.text?.body || '';
  } else if (msg?.type === 'interactive') {
    if (msg.interactive?.button_reply) {
      rawMessage = msg.interactive.button_reply.id || '';
    } else if (msg.interactive?.list_reply) {
      rawMessage = msg.interactive.list_reply.id || '';
    } else if (msg.interactive?.nfm_reply) {
      try {
        const flowResponse = JSON.parse(msg.interactive.nfm_reply.response_json || '{}');
        rawMessage = flowResponse.selected_date || flowResponse.loading_date || flowResponse.date || '';
      } catch {
        rawMessage = msg.interactive.nfm_reply.response_json || '';
      }
    }
  }

  if (typeof rawMessage === 'object') {
    rawMessage = rawMessage?.text || rawMessage?.value || '';
  }

  const message = String(rawMessage).trim();
  const lowerMessage = message.toLowerCase();
  const phone = chat.messages?.[0]?.from || 'unknown_user';

  // ================= SHEET DATA =================
  // masterRows plays the role of n8n's $input.all() (already {json: ...}-less here)
  const items = masterRows.map((r) => ({ json: r }));

  let row = {};
  let normalizedPhone = phone.slice(-10);

  let filteredItems = items.filter((item) => {
    let sheetPhone = String(item.json.phone || '').slice(-10);
    return sheetPhone === normalizedPhone;
  });

  if (filteredItems.length > 0) {
    filteredItems.sort((a, b) => {
      return new Date(b.json.updated_at) - new Date(a.json.updated_at);
    });
    row = filteredItems[0].json;
  }

  // ================= FORCE RESET ON HI =================
  if (['hi', 'Hi', 'hello', 'start', 'restart'].includes(lowerMessage)) {
    const newSessionId = `${phone}_${Date.now()}`;

    return {
      user_id: newSessionId,
      phone: phone,
      state: 'main_menu',
      updated_at: new Date().toISOString(),
      response:
        '🙏 *Welcome to Traket Transport* 🚛\n\n' +
        'We provide reliable logistics solutions across India 🇮🇳\n\n' +
        '👉 Please select your requirement:\n\n' +
        '1️⃣ Book a Vehicle (Customer)\n' +
        '2️⃣ Provide Vehicle (Transporter)\n' +
        '3️⃣ Support\n\n' +
        'Reply with *1, 2 or 3*',
      flowType: '',
      data: '{}',
    };
  }

  // ================= OPTION MAPPINGS =================
  const vehicleTypeMap = {
    1: 'Tempo',
    2: 'Truck',
    3: 'Container',
    4: 'Trailer / ODC',
  };

  const cargoTypeMap = {
    1: 'Domestic',
    2: 'Import',
    3: 'Export',
  };

  const vehicleCategoryMap = {
    tempo_type: 'Tempo',
    truck_type: 'Truck',
    container_type: 'Container',
  };

  const tempoSubTypeMap = {
    1: '7 Ft',
    2: '8 Ft',
    3: '9 Ft',
    4: '14 Ft',
    5: '17 Ft',
  };

  const containerSubTypeMap = {
    1: '20 Ft Container',
    2: '32 Ft Single Axle',
    3: '32 Ft Multi Axle',
  };

  const truckSubTypeMap = {
    1: '16 Ft Truck',
    2: '19 Ft Truck',
    3: '22 Ft Truck',
    4: '24 Ft Truck',
  };

  // ================= STATE =================
  let state = row.state || 'start';

  let oldData = {};
  try {
    oldData = typeof row.data === 'string' ? JSON.parse(row.data) : row.data || {};
  } catch {
    oldData = {};
  }

  let data = { ...oldData };
  let response = '';

  // ================= MAIN MENU =================
  if (state === 'main_menu') {
    const isBookChoice =
      lowerMessage === '1' ||
      lowerMessage === '1️⃣' ||
      ['book', 'customer', 'booking', 'book vehicle', 'book a vehicle'].includes(lowerMessage) ||
      /\b(book|customer)\b/i.test(lowerMessage);

    const isProvideChoice =
      lowerMessage === '2' ||
      lowerMessage === '2️⃣' ||
      ['provide', 'transporter', 'provider', 'provide vehicle', 'provide a vehicle'].includes(lowerMessage) ||
      /\b(provide|transporter)\b/i.test(lowerMessage);

    const isSupportChoice =
      lowerMessage === '3' ||
      lowerMessage === '3️⃣' ||
      ['support', 'help'].includes(lowerMessage) ||
      /\b(support|help)\b/i.test(lowerMessage);

    if (isBookChoice) {
      state = 'route_details';
      data.flowType = 'book';
      response =
        '📍 Enter Route Details\n\n' +
        'Loading Pincode\n' +
        'Unloading Pincode\n\n' +
        'Example:\n' +
        '400701\n' +
        '110020';
    } else if (isProvideChoice) {
      data.flowType = 'provider';
      state = 'vp1_basic_details';
      response =
        '👤 Enter Driver Details\n\n' +
        'Driver Name\n' +
        'Phone Number\n\n' +
        'Example:\n' +
        'Rahul Sharma\n' +
        '9876543210';
    } else if (isSupportChoice) {
      state = 'support_flow';
      data.flowType = 'support';
      response =
        '*Hi, Welcome to Traket Transport*\n' +
        '*Please Contact on +91 9820500159 if your querry doesnt matches                     with the above two options*\n' +
        'Thank you so much for your precious time';
    } else {
      response = '⚠️ Please reply with *1, 2 or 3*';
    }
  }

  // ================= PROVIDER FLOW =================
  else if (state === 'vp1_basic_details') {
    let lines = message
      .split(/\n|,/)
      .map((l) => l.trim())
      .filter(Boolean);

    if (lines.length < 2) {
      response =
        '❌ Please enter:\n\n' +
        'Driver Name\n' +
        'Phone Number\n\n' +
        'Example:\n' +
        'Rahul Sharma\n' +
        '9876543210';
    } else {
      data.provider_driverName = lines[0];
      data.provider_driverPhone = lines[1];

      state = 'vp2_vehicle_type';

      response =
        '🚛 Select Vehicle Type:\n\n' +
        '1️⃣ Tempo\n' +
        '2️⃣ Truck\n' +
        '3️⃣ Container\n' +
        '4️⃣ Trailer / ODC\n\n' +
        'Reply with option number';
    }
  } else if (state === 'vp2_vehicle_type') {
    if (['1', '2', '3', '4'].includes(message)) {
      data.provider_vehicleType = vehicleTypeMap[message];

      state = 'vp3_vehicle_details';

      response =
        '🚚 Enter Vehicle Details\n\n' +
        'Vehicle Number\n' +
        'Capacity\n\n' +
        'Example:\n' +
        'MH04AB1234\n' +
        '10 MT';
    } else {
      response = '⚠️ Enter *1, 2, 3 or 4* only';
    }
  } else if (state === 'vp3_vehicle_details') {
    let lines = message
      .split(/\n|,/)
      .map((l) => l.trim())
      .filter(Boolean);

    if (lines.length < 2) {
      response = '❌ Please enter:\n\n' + 'Vehicle Number\n' + 'Capacity';
    } else {
      data.provider_vehicleNumber = lines[0];
      data.provider_capacity = lines[1];

      state = 'vp4_route_details';

      response =
        '🛣️ Enter Route Details\n\n' +
        'Operating Route\n' +
        'Available From Date\n' +
        'Current Location\n\n' +
        'Example:\n' +
        'Mumbai-Surat\n' +
        '15-Jan-2026\n' +
        'Bhiwandi';
    }
  } else if (state === 'vp4_route_details') {
    let lines = message
      .split(/\n|,/)
      .map((l) => l.trim())
      .filter(Boolean);

    if (lines.length < 3) {
      response =
        '❌ Please enter:\n\n' +
        'Operating Route\n' +
        'Available From Date\n' +
        'Current Location';
    } else {
      data.provider_routes = lines[0];
      data.provider_availability = lines[1];
      data.provider_currentLocation = lines[2];

      state = 'vp5_documents_notes';

      response =
        '📄 Documents Available?\n\n' +
        'YES / NO\n' +
        'Additional Notes\n\n' +
        'Example:\n' +
        'YES\n' +
        'Available Immediately';
    }
  } else if (state === 'vp5_documents_notes') {
    let lines = message
      .split(/\n|,/)
      .map((l) => l.trim())
      .filter(Boolean);

    let documentStatus = (lines[0] || '').toUpperCase();

    if (!['YES', 'NO'].includes(documentStatus)) {
      response = '⚠️ First line must be YES or NO';
    } else {
      data.provider_documents = documentStatus;
      data.provider_notes = lines[1] || 'NA';

      state = 'cta_menu';

      response =
        '🚛 Vehicle Type: ' + (data.provider_vehicleType || '') + '\n' +
        '🔢 Vehicle Number: ' + (data.provider_vehicleNumber || '') + '\n' +
        '⚖️ Capacity: ' + (data.provider_capacity || '') + '\n' +
        '📍 Route: ' + (data.provider_routes || '') + '\n' +
        '📅 Available From: ' + (data.provider_availability || '') + '\n' +
        '📌 Current Location: ' + (data.provider_currentLocation || '') + '\n' +
        '📄 Documents: ' + (data.provider_documents || '') + '\n\n' +
        'Our operations team will contact you shortly for onboarding.\n\n' +
        'Thank you for partnering with us 🤝';
    }
  }

  // ================= CUSTOMER FLOW =================
  else if (state === 'route_details') {
    let lines = message
      .split(/\n|,/)
      .map((l) => l.trim())
      .filter(Boolean);

    let loadingPin = lines[0] || '';
    let unloadingPin = lines[1] || '';

    if (!/^[1-8][0-9]{5}$/.test(loadingPin) || !/^[1-8][0-9]{5}$/.test(unloadingPin)) {
      response =
        '❌ Invalid Format.\n\n' +
        'Please enter:\n\n' +
        'Loading Pincode\n' +
        'Unloading Pincode\n\n' +
        'Example:\n' +
        '400701\n' +
        '110020';
    } else {
      data.loadingPin = loadingPin;
      data.unloadingPin = unloadingPin;

      state = 'cargo_type';

      response =
        '📦 Select Cargo Type:\n\n' +
        '1️⃣ Domestic\n' +
        '2️⃣ Import\n' +
        '3️⃣ Export\n\n' +
        'Reply with *1 / 2 / 3*';
    }
  } else if (state === 'cargo_type') {
    if (['1', '2', '3'].includes(message)) {
      data.cargoType = cargoTypeMap[message];
      state = 'vehicle_category';
      response =
        '🚛 Select Vehicle Type:\n\n' +
        '1️⃣ Tempo\n' +
        '2️⃣ Truck\n' +
        '3️⃣ Container\n' +
        '4️⃣ ODC\n\n' +
        'Reply with option number';
    } else {
      response = '⚠️ Enter *1, 2 or 3*';
    }
  } else if (state === 'vehicle_category') {
    if (message === '1') {
      state = 'tempo_type';
      response =
        '🚚 Please choose Tempo Size 👇\n\n' +
        '1️⃣ Pickup – 1 MT (8×5×5 ft)\n' +
        '2️⃣ 14 Ft – 3 MT (14×6×6 ft)\n' +
        '3️⃣ 19 Ft – 6 MT (19×6×6 ft)\n' +
        '4️⃣ 22 Ft – 9 MT (22×7×7 ft)\n\n' +
        'Reply with option number';
    } else if (message === '2') {
      state = 'truck_type';
      response =
        '🚛 Please choose Truck Type 👇\n\n' +
        '1️⃣ 16 Ft Truck\n' +
        '2️⃣ 19 Ft Truck\n' +
        '3️⃣ 22 Ft Truck\n' +
        '4️⃣ 24 Ft Truck\n\n' +
        'Reply with option number';
    } else if (message === '3') {
      state = 'container_type';
      response =
        '📦 Please select Container Type 🚢\n\n' +
        '1️⃣ 20 Ft Container\n' +
        '2️⃣ 32 Ft Single Axle\n' +
        '3️⃣ 32 Ft Multi Axle\n\n' +
        'Reply with option number';
    } else if (message === '4') {
      state = 'odc_details';
      response = '⚠️ Enter ODC Details (Material, Size, Weight)';
    } else {
      response = '⚠️ Please select a valid option';
    }
  } else if (state === 'odc_details') {
    data.vehicleType = 'ODC';
    data.vehicleSubType = 'ODC';

    data.material = message;

    state = 'shipment_details';

    response =
      '📦 Enter Shipment Details\n\n' +
      'Material Name\n' +
      'Weight\n' +
      'Packages\n' +
      'Loading Date\n\n' +
      'Example:\n' +
      'Steel Pipes\n' +
      '10 MT\n' +
      '25 Packages\n' +
      '15-Jan-2026';
  }

  // ================= SUBTYPE =================
  else if (state === 'tempo_type') {
    if (tempoSubTypeMap[message]) {
      data.vehicleType = vehicleCategoryMap[state];
      data.vehicleSubType = tempoSubTypeMap[message];
      state = 'shipment_details';

      response =
        '📦 Enter Shipment Details\n\n' +
        'Material Name\n' +
        'Weight\n' +
        'Packages\n' +
        'Loading Date\n\n' +
        'Example:\n' +
        'Steel Pipes\n' +
        '10 MT\n' +
        '25 Packages\n' +
        '15-Jan-2026';
    } else {
      response = '⚠️ Please select a valid option (1-5)';
    }
  } else if (state === 'container_type') {
    if (containerSubTypeMap[message]) {
      data.vehicleType = vehicleCategoryMap[state];
      data.vehicleSubType = containerSubTypeMap[message];
      state = 'shipment_details';

      response =
        '📦 Enter Shipment Details\n\n' +
        'Material Name\n' +
        'Weight\n' +
        'Packages\n' +
        'Loading Date\n\n' +
        'Example:\n' +
        'Steel Pipes\n' +
        '10 MT\n' +
        '25 Packages\n' +
        '15-Jan-2026';
    } else {
      response = '⚠️ Please select a valid option (1-3)';
    }
  } else if (state === 'truck_type') {
    if (truckSubTypeMap[message]) {
      data.vehicleType = vehicleCategoryMap[state];
      data.vehicleSubType = truckSubTypeMap[message];
      state = 'shipment_details';

      response =
        '📦 Enter Shipment Details\n\n' +
        'Material Name\n' +
        'Weight\n' +
        'Packages\n' +
        'Loading Date\n\n' +
        'Example:\n' +
        'Steel Pipes\n' +
        '10 MT\n' +
        '25 Packages\n' +
        '15-Jan-2026';
    } else {
      response = '⚠️ Please select a valid option (1-4)';
    }
  } else if (state === 'shipment_details') {
    let lines = message
      .split(/\n|,/)
      .map((l) => l.trim())
      .filter(Boolean);

    if (lines.length < 4) {
      response =
        '❌ Please enter all shipment details.\n\n' +
        'Material Name\n' +
        'Weight\n' +
        'Packages\n' +
        'Loading Date\n\n' +
        'Example:\n' +
        'Steel Pipes\n' +
        '10 MT\n' +
        '25 Packages\n' +
        '15-Jan-2026';
    } else {
      const materialName = lines[0] || '';
      const weight = lines[1] || '';
      const packages = lines[2] || '';

      data.material = 'Material: ' + materialName + '\nWeight: ' + weight + '\nPackages: ' + packages;

      data.loadingDate = lines[3] || '';

      state = 'contact_details';

      response =
        '👤 Enter Contact Details\n\n' +
        'Company Name\n' +
        'Contact Person\n' +
        'Phone Number\n' +
        'Email\n' +
        'Website (or NA)\n\n' +
        'Example:\n' +
        'ABC Logistics\n' +
        'Rahul Sharma\n' +
        '9876543210\n' +
        'rahul@gmail.com\n' +
        'www.abc.com';
    }
  } else if (state === 'contact_details') {
    const text = message;

    const phoneMatch = text.match(/\d{10}/);
    const phoneExtracted = phoneMatch ? phoneMatch[0] : '';

    const emailMatch = text.match(/\S+@\S+\.\S+/);
    const emailExtracted = emailMatch ? emailMatch[0] : 'NA';

    let websiteExtracted = 'NA';
    if (/www\.|http/.test(text)) {
      let webMatch = text.match(/(https?:\/\/[^\s]+|www\.[^\s]+)/);
      websiteExtracted = webMatch ? webMatch[0] : 'NA';
    }

    let lines = text
      .split(/\n/)
      .map((l) => l.trim())
      .filter(Boolean);

    let company = '';
    let contactName = '';

    if (lines.length >= 3) {
      company = lines[0];
      contactName = lines[1];
    } else {
      let remaining = text.replace(phoneExtracted, '').replace(emailExtracted, '').replace(websiteExtracted, '').trim();

      let parts = remaining
        .split(/,|-/)
        .map((p) => p.trim())
        .filter(Boolean);

      if (parts.length >= 2) {
        company = parts[0];
        contactName = parts[1];
      }
    }

    data.company = company;
    data.contactName = contactName;
    data.phone = phoneExtracted;
    data.email = emailExtracted;
    data.website = websiteExtracted;

    state = 'cta_menu';

    response =
      'From :        ' + (data.loadingPin || '') + '\n' +
      'To :          ' + (data.unloadingPin || '') + '\n' +
      'Trip :        ' + (data.cargoType || '') + '\n' +
      'Vehicle :     ' + (data.vehicleType || '') + '\n' +
      'Sub vehicle : ' + (data.vehicleSubType || '') + '\n' +
      'Goods type :  ' + (data.material || '') + '\n' +
      'Loading Date :' + (data.loadingDate || '') + '\n\n' +
      'Name :' + (data.contactName || '') + '\n\n' +
      'Phone Number :' + (data.phone || '') + '\n\n' +
      'Thank you for Partnering with Us 🤝';
  } else if (state === 'support_flow') {
    state = 'cta_menu';

    response =
      '📞 Our support team will assist you shortly.\n\n' +
      'For urgent queries call: +91 9820500159\n\n' +
      'Thank you for contacting Traket 🤝';
  }

  // ================= CTA MENU =================
  else if (state === 'cta_menu') {
    if (message === 'cta_new') {
      state = 'main_menu';
      data = {};
      response =
        '🙏 *Welcome to Traket Transport* 🚛\n\n' +
        'We provide reliable logistics solutions across India 🇮🇳\n\n' +
        '👉 Please select your requirement:\n\n' +
        '1️⃣ Book a Vehicle (Customer)\n' +
        '2️⃣ Provide Vehicle (Transporter)\n' +
        '3️⃣ Support\n\n' +
        'Reply with *1, 2 or 3*';
    } else if (message === 'cta_ai' || lowerMessage === 'know about traket' || lowerMessage.includes('know about traket')) {
      state = 'cta_ai';
      response =
        '🌐 *Welcome to Traket Transport* 🚛\n\n' +
        'We provide fast, reliable, and technology-driven logistics solutions across India 🇮🇳\n\n' +
        '🔗 *Visit our official website:* https://traket.in/\n\n' +
        'Type *Hi* anytime to return to the main menu!';
    } else if (message === 'cta_support') {
      state = 'support_flow';
      response =
        '*Hi, Welcome to Traket Transport*\n' +
        '*Please Contact on +91 9820500159 if your querry doesnt matches                     with the above two options*\n' +
        'Thank you so much for your precious time';
    } else {
      response = '⚠️ Please select an option';
    }
  }

  // ================= DEFAULT =================
  else {
    response = '👋 Type *Hi* to start again';
  }

  // ================= OUTPUT =================
  const output = { ...row };

  output.user_id = row.user_id;

  if (message === 'cta_new') {
    output.user_id = `${phone}_${Date.now()}`;
  }
  output.phone = phone;
  output.state = state;
  output.updated_at = new Date().toISOString();
  output.response = response;

  output.flowType = data.flowType ?? row.flowType ?? '';
  output.data = JSON.stringify(data);

  return output;
}

module.exports = { processConversation };
