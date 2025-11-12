/* global WildRydes, _config */

(function bookingScope($) {
  "use strict";

  const state = {
    authToken: null,
    estimate: null,
    currency: "USD",
    history: [],
  };

  const API_ROOT = (_config && _config.api && _config.api.invokeUrl) || null;

  const $form = $("#bookingForm");
  const $estimateButton = $("#estimateButton");
  const $confirmButton = $("#confirmButton");
  const $refreshHistory = $("#refreshHistory");
  const $status = $("#bookingStatus");
  const $statusBody = $("#statusBody");
  const $statusMeta = $("#statusMeta");
  const $fareTotal = $("#fareTotal");
  const $fareBase = $("#fareBase");
  const $fareDistance = $("#fareDistance");
  const $fareTime = $("#fareTime");
  const $fareFees = $("#fareFees");
  const $metaDistance = $("#metaDistance");
  const $metaDuration = $("#metaDuration");
  const $metaSurge = $("#metaSurge");
  const $historyRows = $("#historyRows");
  const $pickupLat = $("#pickupLat");
  const $pickupLng = $("#pickupLng");
  const $dropoffLat = $("#dropoffLat");
  const $dropoffLng = $("#dropoffLng");
  const $mapSelectionDetails = $("#mapSelectionDetails");
  const $mapModeButtons = $(".map-mode-toggle button");
  const $pickupInput = $("#pickup");
  const $dropoffInput = $("#dropoff");

  let mapSelectionMode = "pickup";

  function formatCurrency(amount, currency) {
    if (typeof amount !== "number" || Number.isNaN(amount)) {
      return "--";
    }
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency || state.currency || "USD",
      maximumFractionDigits: 2,
    }).format(amount);
  }

  function setStatus(type, message, meta) {
    $status
      .removeClass("active success error loading")
      .addClass(`active ${type}`);
    $statusBody.text(message || "");

    $statusMeta.empty();
    if (Array.isArray(meta) && meta.length) {
      meta.forEach((item) => {
        if (!item || !item.label) {
          return;
        }
        const value =
          typeof item.value === "undefined" || item.value === null
            ? "--"
            : item.value;
        const row = $("<span></span>").append(
          $("<span></span>").text(item.label),
          $("<span></span>").text(value)
        );
        $statusMeta.append(row);
      });
    }
  }

  function ensureAuth() {
    if (state.authToken) {
      return Promise.resolve(state.authToken);
    }
    return WildRydes.authToken.then((token) => {
      if (!token) {
        window.location.href = "/signin.html";
        return Promise.reject(new Error("Not authenticated"));
      }
      state.authToken = token;
      return token;
    });
  }

  function callApi(path, method, payload) {
    if (!API_ROOT) {
      return Promise.reject(new Error("API not configured"));
    }
    return ensureAuth().then((token) =>
      fetch(`${API_ROOT}${path}`, {
        method: method || "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: token,
        },
        body: payload ? JSON.stringify(payload) : undefined,
      }).then((response) => {
        if (!response.ok) {
          return response
            .json()
            .catch(() => ({}))
            .then((data) => {
              const message =
                data.message ||
                data.error ||
                `Request failed (${response.status})`;
              const error = new Error(message);
              error.details = data;
              throw error;
            });
        }
        if (response.status === 204) {
          return {};
        }
        return response.json();
      })
    );
  }

  function buildPayload() {
    const formData = new FormData($form[0]);
    const pickup = formData.get("pickup").trim();
    const dropoff = formData.get("dropoff").trim();
    const pickupTimeValue = formData.get("pickupTime");
    const rideType = formData.get("rideType") || "standard";
    const passengers = Number(formData.get("passengers") || 1);
    const luggage = Number(formData.get("luggage") || 0);
    const notes = formData.get("notes")?.trim() || "";
    const distanceHint = Number(formData.get("distanceHint") || 0) || null;
    const durationHint = Number(formData.get("durationHint") || 0) || null;

    const payload = {
      pickup,
      dropoff,
      pickupTime: pickupTimeValue
        ? new Date(pickupTimeValue).toISOString()
        : new Date().toISOString(),
      rideType,
      passengers,
      luggage,
      notes,
      distanceHint,
      durationHint,
    };
    const pickupLatVal = parseFloat($pickupLat.val());
    const pickupLngVal = parseFloat($pickupLng.val());
    if (!Number.isNaN(pickupLatVal) && !Number.isNaN(pickupLngVal)) {
      payload.pickupLocation = {
        latitude: pickupLatVal,
        longitude: pickupLngVal,
      };
    }
    const dropoffLatVal = parseFloat($dropoffLat.val());
    const dropoffLngVal = parseFloat($dropoffLng.val());
    if (!Number.isNaN(dropoffLatVal) && !Number.isNaN(dropoffLngVal)) {
      payload.dropoffLocation = {
        latitude: dropoffLatVal,
        longitude: dropoffLngVal,
      };
    }
    return payload;
  }

  function peakHourMultiplier(date) {
    const hour = date.getHours();
    if ((hour >= 7 && hour < 9) || (hour >= 17 && hour < 20)) {
      return 1.25;
    }
    if (hour >= 22 || hour < 5) {
      return 1.15;
    }
    return 1.0;
  }

  function computeLocalEstimate(payload) {
    const defaults = {
      standard: { base: 4.5, perKm: 1.15, perMin: 0.3 },
      executive: { base: 8.5, perKm: 1.85, perMin: 0.45 },
      xl: { base: 9.0, perKm: 2.1, perMin: 0.5 },
      green: { base: 5.0, perKm: 1.25, perMin: 0.35 },
    };

    const config = defaults[payload.rideType] || defaults.standard;
    const pickupTime = new Date(payload.pickupTime);
    const distance =
      payload.distanceHint && payload.distanceHint > 0
        ? payload.distanceHint
        : 8.5;
    const duration =
      payload.durationHint && payload.durationHint > 0
        ? payload.durationHint
        : Math.max(Math.round(distance * 3), 12);
    const surgeMultiplier = peakHourMultiplier(pickupTime);
    const baseFare = config.base;
    const distanceFare = distance * config.perKm;
    const timeFare = duration * config.perMin;
    const subtotal = (baseFare + distanceFare + timeFare) * surgeMultiplier;
    const taxes = subtotal * 0.1;
    const total = subtotal + taxes;

    return {
      id: `local-${Date.now()}`,
      fare: {
        total,
        base: baseFare,
        distance: distanceFare,
        time: timeFare,
        taxes,
        surgeMultiplier,
        currency: state.currency,
      },
      distanceKm: distance,
      durationMinutes: duration,
      pickupTime: payload.pickupTime,
      pickup: payload.pickup,
      dropoff: payload.dropoff,
      rideType: payload.rideType,
      createdAt: new Date().toISOString(),
      source: "local",
      pickupLocation: payload.pickupLocation,
      dropoffLocation: payload.dropoffLocation,
    };
  }

  function normaliseEstimate(response, payload) {
    if (!response || typeof response !== "object") {
      return computeLocalEstimate(payload);
    }
    const fare = response.fare || response;
    const currency =
      fare.currency || response.currency || state.currency || "USD";
    state.currency = currency;

    return {
      id: response.estimateId || response.id || `estimate-${Date.now()}`,
      fare: {
        total: fare.totalAmount || fare.total || fare.amount || 0,
        base: fare.baseAmount || fare.base || 0,
        distance: fare.distanceAmount || fare.distance || 0,
        time: fare.timeAmount || fare.time || 0,
        taxes: fare.taxes || fare.fees || 0,
        surgeMultiplier: fare.surgeMultiplier || fare.multiplier || 1,
        currency,
      },
      distanceKm:
        response.distanceKm || response.distance || payload.distanceHint || 0,
      durationMinutes:
        response.durationMinutes ||
        response.duration ||
        payload.durationHint ||
        0,
      pickupTime: payload.pickupTime,
      pickup: payload.pickup,
      dropoff: payload.dropoff,
      rideType: payload.rideType,
      createdAt: new Date().toISOString(),
      source: "api",
      pickupLocation: payload.pickupLocation,
      dropoffLocation: payload.dropoffLocation,
    };
  }

  function updateSummary(estimate) {
    const fare = estimate.fare;
    $fareTotal.text(formatCurrency(fare.total, fare.currency));
    $fareBase.text(formatCurrency(fare.base, fare.currency));
    $fareDistance.text(formatCurrency(fare.distance, fare.currency));
    $fareTime.text(formatCurrency(fare.time, fare.currency));
    $fareFees.text(formatCurrency(fare.taxes, fare.currency));

    const distanceValue = estimate.distanceKm
      ? `${estimate.distanceKm.toFixed(1)} km`
      : "--";
    const durationValue = estimate.durationMinutes
      ? `${Math.round(estimate.durationMinutes)} min`
      : "--";
    const surgeValue = `x${(fare.surgeMultiplier || 1).toFixed(2)}`;

    $metaDistance.text(distanceValue);
    $metaDuration.text(durationValue);
    $metaSurge.text(surgeValue);
  }

  function renderHistory(entries) {
    if (!entries || !entries.length) {
      $historyRows.addClass("ride-history-empty").text("No rides booked yet.");
      return;
    }

    $historyRows.removeClass("ride-history-empty");
    const markup = entries
      .map((item) => {
        const fare = formatCurrency(
          item.fare?.total || item.totalAmount || 0,
          item.fare?.currency || state.currency
        );
        const pickupTime = item.pickupTime
          ? new Date(item.pickupTime).toLocaleString()
          : "--";
        const status = item.status || item.state || "Scheduled";
        const pickupCoords =
          item.pickupLocation &&
          typeof item.pickupLocation.latitude === "number"
            ? `${item.pickupLocation.latitude.toFixed(
                4
              )}, ${item.pickupLocation.longitude.toFixed(4)}`
            : null;
        const dropoffCoords =
          item.dropoffLocation &&
          typeof item.dropoffLocation.latitude === "number"
            ? `${item.dropoffLocation.latitude.toFixed(
                4
              )}, ${item.dropoffLocation.longitude.toFixed(4)}`
            : null;
        return `
          <div class="fare-breakdown" style="padding:1.25rem;margin-bottom:1rem;">
            <div class="fare-row" style="margin-bottom:1rem;">
              <span>${item.pickup || "--"} → ${item.dropoff || "--"}</span>
              <strong>${fare}</strong>
            </div>
            <div class="estimate-meta" style="gap:0.4rem;">
              <div class="meta-item">
                <span>Pickup</span>
                <span>${pickupTime}</span>
              </div>
              <div class="meta-item">
                <span>Status</span>
                <span>${status}</span>
              </div>
              <div class="meta-item">
                <span>Ride Type</span>
                <span>${
                  (item.rideType || "").toString().toUpperCase() || "--"
                }</span>
              </div>
              ${
                pickupCoords
                  ? `<div class="meta-item"><span>Pickup Coords</span><span>${pickupCoords}</span></div>`
                  : ""
              }
              ${
                dropoffCoords
                  ? `<div class="meta-item"><span>Destination Coords</span><span>${dropoffCoords}</span></div>`
                  : ""
              }
            </div>
          </div>
        `;
      })
      .join("");

    $historyRows.html(markup);
  }

  function normaliseHistoryItem(entry) {
    if (!entry || typeof entry !== "object") {
      return null;
    }
    return {
      id: entry.bookingId || entry.id || `history-${Date.now()}`,
      pickup: entry.pickup || entry.pickupAddress || "--",
      dropoff: entry.dropoff || entry.dropoffAddress || "--",
      pickupTime: entry.pickupTime || entry.scheduledTime || null,
      rideType: entry.rideType || "standard",
      fare: entry.fare
        ? entry.fare
        : {
            total: entry.totalAmount || 0,
            currency: entry.currency || state.currency,
          },
      status: entry.status || entry.bookingStatus || "Scheduled",
      pickupLocation: entry.pickupLocation ||
        entry.pickupCoordinates || {
          latitude: entry.pickupLatitude,
          longitude: entry.pickupLongitude,
        },
      dropoffLocation: entry.dropoffLocation ||
        entry.dropoffCoordinates || {
          latitude: entry.dropoffLatitude,
          longitude: entry.dropoffLongitude,
        },
    };
  }

  function fetchHistory() {
    if (!API_ROOT) {
      renderHistory(state.history);
      return;
    }

    setStatus("loading", "Refreshing ride history…");
    callApi("/ride", "GET")
      .then((response) => {
        const items = Array.isArray(response) ? response : response.items || [];
        const normalised = items
          .map(normaliseHistoryItem)
          .filter(Boolean)
          .sort((a, b) => {
            const aTime = a.pickupTime ? Date.parse(a.pickupTime) : 0;
            const bTime = b.pickupTime ? Date.parse(b.pickupTime) : 0;
            return bTime - aTime;
          });
        renderHistory(normalised);
        setStatus("success", "History updated.", [
          {
            label: "Entries",
            value: normalised.length,
          },
        ]);
      })
      .catch((error) => {
        console.error("Failed to load history", error);
        renderHistory(state.history);
        setStatus(
          "error",
          error.message || "Unable to load ride history. Showing local data."
        );
      });
  }

  function handleEstimate(event) {
    event.preventDefault();
    const payload = buildPayload();

    if (!payload.pickup || !payload.dropoff) {
      setStatus("error", "Pickup and destination are required.");
      return;
    }

    setStatus("loading", "Contacting fare service…");
    $confirmButton.prop("disabled", true);

    const handleSuccess = (estimate) => {
      state.estimate = estimate;
      updateSummary(estimate);
      $confirmButton.prop("disabled", false);
      setStatus("success", "Fare estimate updated.", [
        {
          label: "Total",
          value: formatCurrency(estimate.fare.total, estimate.fare.currency),
        },
        {
          label: "Distance",
          value: estimate.distanceKm
            ? `${estimate.distanceKm.toFixed(1)} km`
            : "--",
        },
        {
          label: "Surge",
          value: `x${(estimate.fare.surgeMultiplier || 1).toFixed(2)}`,
        },
      ]);
    };

    if (!API_ROOT) {
      handleSuccess(computeLocalEstimate(payload));
      return;
    }

    callApi("/ride", "POST", payload)
      .then((response) => handleSuccess(normaliseEstimate(response, payload)))
      .catch((error) => {
        console.error("Estimate failed", error);
        const fallbackEstimate = computeLocalEstimate(payload);
        state.estimate = fallbackEstimate;
        updateSummary(fallbackEstimate);
        $confirmButton.prop("disabled", false);
        setStatus(
          "error",
          "Unable to reach the pricing API. Showing an offline estimate.",
          [
            {
              label: "Total",
              value: formatCurrency(
                fallbackEstimate.fare.total,
                fallbackEstimate.fare.currency
              ),
            },
          ]
        );
      });
  }

  function handleConfirm(event) {
    event.preventDefault();
    if (!state.estimate) {
      setStatus(
        "error",
        "Generate an estimate before confirming your booking."
      );
      return;
    }

    const payload = buildPayload();
    const bookingPayload = {
      ...payload,
      estimateId: state.estimate.id,
    };

    const handleBookingSuccess = (response, fallback = false) => {
      const bookingId =
        response.bookingId ||
        response.id ||
        state.estimate.id ||
        `booking-${Date.now()}`;
      const eta =
        response.eta || response.estimatedArrival || payload.pickupTime;
      const fare = response.fare || state.estimate.fare;

      const summaryMeta = [
        { label: "Booking ID", value: bookingId },
        {
          label: "Pickup",
          value: payload.pickup,
        },
        {
          label: "Destination",
          value: payload.dropoff,
        },
        {
          label: "ETA",
          value: eta ? new Date(eta).toLocaleString() : "--",
        },
        {
          label: "Fare",
          value: formatCurrency(fare.total, fare.currency),
        },
      ];
      if (payload.pickupLocation) {
        summaryMeta.push({
          label: "Pickup Coords",
          value: `${payload.pickupLocation.latitude?.toFixed?.(4) ?? "--"}, ${
            payload.pickupLocation.longitude?.toFixed?.(4) ?? "--"
          }`,
        });
      }
      if (payload.dropoffLocation) {
        summaryMeta.push({
          label: "Dest Coords",
          value: `${payload.dropoffLocation.latitude?.toFixed?.(4) ?? "--"}, ${
            payload.dropoffLocation.longitude?.toFixed?.(4) ?? "--"
          }`,
        });
      }

      setStatus(
        fallback ? "success" : "success",
        fallback
          ? "Ride scheduled using offline mode."
          : "Ride booked successfully.",
        summaryMeta
      );

      const historyEntry = normaliseHistoryItem({
        bookingId,
        pickup: payload.pickup,
        dropoff: payload.dropoff,
        pickupTime: payload.pickupTime,
        rideType: payload.rideType,
        fare,
        status: response.status || "Scheduled",
        pickupLocation: payload.pickupLocation,
        dropoffLocation: payload.dropoffLocation,
      });

      state.history.unshift(historyEntry);
      renderHistory(state.history.slice(0, 5));
      $confirmButton.prop("disabled", true);
    };

    setStatus("loading", "Finalising your booking…");
    $confirmButton.prop("disabled", true);

    if (!API_ROOT) {
      handleBookingSuccess(
        {
          bookingId: state.estimate.id,
          eta: payload.pickupTime,
          fare: state.estimate.fare,
        },
        true
      );
      return;
    }

    callApi("/ride", "POST", bookingPayload)
      .then((response) => handleBookingSuccess(response))
      .catch((error) => {
        console.error("Booking failed", error);
        setStatus(
          "error",
          error.message || "Unable to confirm booking. Please try again.",
          [
            {
              label: "Estimate ID",
              value: state.estimate.id,
            },
          ]
        );
        $confirmButton.prop("disabled", false);
      });
  }

  function initDefaultPickupTime() {
    const $pickupTime = $("#pickupTime");
    const currentValue = $pickupTime.val();
    if (currentValue) {
      return;
    }
    const now = new Date(Date.now() + 5 * 60 * 1000);
    const formatted = new Date(now.getTime() - now.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 16);
    $pickupTime.val(formatted);
  }

  function attachEvents() {
    $estimateButton.on("click", handleEstimate);
    $confirmButton.on("click", handleConfirm);
    $refreshHistory.on("click", function refreshClick(event) {
      event.preventDefault();
      fetchHistory();
    });
    $("#navSignOut").on("click", function signOut(event) {
      event.preventDefault();
      if (typeof WildRydes.signOut === "function") {
        WildRydes.signOut();
      }
      window.location.href = "/signin.html";
    });
    $mapModeButtons.on("click", function mapModeHandler(event) {
      event.preventDefault();
      const mode = $(this).data("mode");
      setMapMode(mode);
    });
    $pickupInput.on("input", function () {
      $(this).data("mapFilled", false);
    });
    $dropoffInput.on("input", function () {
      $(this).data("mapFilled", false);
    });
  }

  function boot() {
    initDefaultPickupTime();
    attachEvents();
    // Preload minimal history from memory to keep UI populated.
    renderHistory(state.history);
    setStatus(
      "loading",
      API_ROOT
        ? "Ready when you are. Generate an estimate to begin."
        : "API gateway not configured; using offline estimation."
    );
    if (API_ROOT) {
      fetchHistory();
    }
    initializeMapIntegration();
  }

  function initializeMapIntegration() {
    setMapMode(mapSelectionMode);
    if (!window.WildRydes || !WildRydes.map) {
      $mapSelectionDetails.text(
        "Map initialising… when ready, use it to place pickup and destination markers."
      );
      return;
    }

    try {
      WildRydes.map.selectionMode = mapSelectionMode;
      $(WildRydes.map).on(
        "pickupChange locationChange",
        function handleLocationChange(event, mode, point) {
          const activeMode = typeof mode === "string" ? mode : mapSelectionMode;
          const geometry = point || WildRydes.map.selectedPoint;
          if (!geometry) {
            return;
          }
          const latitude =
            typeof geometry.latitude === "number"
              ? geometry.latitude
              : geometry.y;
          const longitude =
            typeof geometry.longitude === "number"
              ? geometry.longitude
              : geometry.x;

          if (typeof latitude !== "number" || typeof longitude !== "number") {
            return;
          }

          if (activeMode === "dropoff") {
            $dropoffLat.val(latitude.toFixed(6));
            $dropoffLng.val(longitude.toFixed(6));
            if (
              !$dropoffInput.val().trim() ||
              $dropoffInput.data("mapFilled") === true
            ) {
              $dropoffInput
                .val(
                  `Map selection (${latitude.toFixed(4)}, ${longitude.toFixed(
                    4
                  )})`
                )
                .data("mapFilled", true);
            }
          } else {
            $pickupLat.val(latitude.toFixed(6));
            $pickupLng.val(longitude.toFixed(6));
            if (
              !$pickupInput.val().trim() ||
              $pickupInput.data("mapFilled") === true
            ) {
              $pickupInput
                .val(
                  `Map selection (${latitude.toFixed(4)}, ${longitude.toFixed(
                    4
                  )})`
                )
                .data("mapFilled", true);
            }
          }

          updateMapSelectionDetails();
        }
      );
    } catch (error) {
      console.warn("Map integration unavailable:", error);
      $mapSelectionDetails.text(
        "Unable to load map selection. Please enter pickup and destination manually."
      );
    }
  }

  function setMapMode(mode) {
    mapSelectionMode = mode === "dropoff" ? "dropoff" : "pickup";
    $mapModeButtons.removeClass("active");
    $mapModeButtons
      .filter(`[data-mode="${mapSelectionMode}"]`)
      .addClass("active");
    if (window.WildRydes && WildRydes.map) {
      WildRydes.map.selectionMode = mapSelectionMode;
    }
    updateMapSelectionDetails();
  }

  function updateMapSelectionDetails() {
    const pickupLatVal = $pickupLat.val();
    const pickupLngVal = $pickupLng.val();
    const dropoffLatVal = $dropoffLat.val();
    const dropoffLngVal = $dropoffLng.val();

    let message = "Click the map to place a marker for your pickup point.";

    if (pickupLatVal && pickupLngVal) {
      message = `Pickup set at <strong>${parseFloat(pickupLatVal).toFixed(
        4
      )}, ${parseFloat(pickupLngVal).toFixed(4)}</strong>.`;
    }

    if (dropoffLatVal && dropoffLngVal) {
      message += ` Destination set at <strong>${parseFloat(
        dropoffLatVal
      ).toFixed(4)}, ${parseFloat(dropoffLngVal).toFixed(4)}</strong>.`;
    } else {
      message += " Switch to “Set Destination” to drop a destination marker.";
    }

    $mapSelectionDetails.html(message);
  }

  $(boot);
})(jQuery);

// ---------- LEX CHATBOT INTEGRATION ----------
// Place this anywhere in booking.js, preferably after your boot/init functions

// ---------- LEX CHATBOT FOR GUEST USERS ----------
(function initLexGuestBot() {
    // Replace these placeholders with your actual values
    const LEX_BOT_REGION = 'eu-west-2'; // e.g., 'us-east-1'
    const IDENTITY_POOL_ID = 'eu-north-1_E2gRQ72g7'; // Cognito Identity Pool ID that allows guest access
    const BOT_NAME = 'RideAssistantBot';
    const BOT_ALIAS = 'Test';

    // Create chat box container if not already in HTML
    if (!document.getElementById('lexChatContainer')) {
        const chatContainer = document.createElement('div');
        chatContainer.id = 'lexChatContainer';
        chatContainer.style = 'position:fixed;bottom:10px;right:10px;width:300px;height:400px;border:1px solid #ccc;background:#fff;display:flex;flex-direction:column;z-index:1000;';
        chatContainer.innerHTML = `
            <div id="lexMessages" style="flex:1;padding:5px;overflow-y:auto;font-size:14px;"></div>
            <input id="lexInput" type="text" placeholder="Ask me anything..." style="border-top:1px solid #ccc;padding:5px;width:100%;box-sizing:border-box;" />
        `;
        document.body.appendChild(chatContainer);
    }

    const lexMessages = document.getElementById('lexMessages');
    const lexInput = document.getElementById('lexInput');

    function appendMessage(sender, message) {
        const msgDiv = document.createElement('div');
        msgDiv.style.marginBottom = '8px';
        msgDiv.innerHTML = `<strong>${sender}:</strong> ${message}`;
        lexMessages.appendChild(msgDiv);
        lexMessages.scrollTop = lexMessages.scrollHeight;
    }

    // Initialize AWS SDK for guest access
    AWS.config.region = LEX_BOT_REGION;
    AWS.config.credentials = new AWS.CognitoIdentityCredentials({
        IdentityPoolId: IDENTITY_POOL_ID
        // No Logins key since this is guest (unauthenticated)
    });

    const lexruntime = new AWS.LexRuntime({ region: LEX_BOT_REGION });

    // Handle sending message to Lex
    lexInput.addEventListener('keypress', function (e) {
        if (e.key === 'Enter' && lexInput.value.trim() !== '') {
            const userMessage = lexInput.value.trim();
            appendMessage('You', userMessage);
            lexInput.value = '';

            const params = {
                botAlias: BOT_ALIAS,
                botName: BOT_NAME,
                inputText: userMessage,
                userId: 'guest_' + Date.now(), // unique userId for session
                sessionAttributes: {}
            };

            lexruntime.postText(params, function(err, data) {
                if (err) {
                    console.error(err);
                    appendMessage('Bot', 'Sorry, something went wrong.');
                } else {
                    appendMessage('Bot', data.message || '...');
                }
            });
        }
    });

})();
