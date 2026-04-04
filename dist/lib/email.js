"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendBookingCreated = sendBookingCreated;
exports.sendBookingStatusUpdate = sendBookingStatusUpdate;
const resend_1 = require("resend");
const FROM = process.env.EMAIL_FROM || "Schedully <noreply@schedully.app>";
// Lazy init — only instantiated when actually sending, not at startup
function getResend() {
    const key = process.env.RESEND_API_KEY;
    if (!key)
        return null;
    return new resend_1.Resend(key);
}
// ─── Helpers ───────────────────────────────────────────────────────────────
function formatDate(date) {
    return new Date(date + "T12:00:00").toLocaleDateString("en-US", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
    });
}
function formatTime(time) {
    const [h, m] = time.split(":").map(Number);
    const ampm = h >= 12 ? "PM" : "AM";
    const hour = h % 12 || 12;
    return `${hour}:${m.toString().padStart(2, "0")} ${ampm}`;
}
// ─── Base layout ───────────────────────────────────────────────────────────
function layout(title, body) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background:#0f1117;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f1117;padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">
          <tr>
            <td style="padding-bottom:32px;">
              <span style="font-size:22px;font-style:italic;font-weight:700;color:#f59e0b;letter-spacing:-0.5px;">Schedully</span>
            </td>
          </tr>
          <tr>
            <td style="background:#1a1d27;border:1px solid #2a2d3a;border-radius:12px;padding:32px;">
              ${body}
            </td>
          </tr>
          <tr>
            <td style="padding-top:24px;text-align:center;">
              <p style="margin:0;font-size:12px;color:#4a4d5a;">
                Schedully · Smart scheduling for modern businesses
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
function detailRow(label, value) {
    return `<tr>
    <td style="padding:8px 0;border-bottom:1px solid #2a2d3a;">
      <span style="font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;">${label}</span><br/>
      <span style="font-size:15px;color:#e5e7eb;font-weight:500;">${value}</span>
    </td>
  </tr>`;
}
function summaryTable(d) {
    return `<table width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0;">
    ${detailRow("Date", formatDate(d.date))}
    ${detailRow("Time", `${formatTime(d.startTime)} – ${formatTime(d.endTime)}`)}
    ${detailRow("Service", d.serviceName)}
    ${detailRow("Price", `$${parseFloat(d.price).toFixed(2)}`)}
    ${d.notes ? detailRow("Notes", d.notes) : ""}
  </table>`;
}
// ─── HTML templates ────────────────────────────────────────────────────────
function bookingCreatedClientHtml(d) {
    return layout("Booking Received", `
    <h1 style="margin:0 0 8px;font-size:24px;color:#f3f4f6;">Booking received</h1>
    <p style="margin:0 0 4px;font-size:15px;color:#9ca3af;">
      Hi <strong style="color:#e5e7eb;">${d.clientName}</strong>, your booking at
      <strong style="color:#f59e0b;">${d.businessName}</strong> is pending confirmation.
    </p>
    ${summaryTable(d)}
    <p style="margin:0;font-size:13px;color:#6b7280;">
      You'll receive another email once the business confirms your appointment.
    </p>
  `);
}
function bookingCreatedOwnerHtml(d) {
    return layout("New Booking", `
    <h1 style="margin:0 0 8px;font-size:24px;color:#f3f4f6;">New booking</h1>
    <p style="margin:0 0 4px;font-size:15px;color:#9ca3af;">
      <strong style="color:#e5e7eb;">${d.clientName}</strong> (${d.clientEmail}) just booked
      <strong style="color:#f59e0b;">${d.serviceName}</strong>.
    </p>
    ${summaryTable(d)}
    <p style="margin:0;font-size:13px;color:#6b7280;">
      Log into your dashboard to confirm or cancel this booking.
    </p>
  `);
}
function bookingStatusHtml(d, status) {
    const isConfirmed = status === "confirmed";
    const accent = isConfirmed ? "#22c55e" : "#ef4444";
    const title = isConfirmed ? "Booking confirmed" : "Booking cancelled";
    const message = isConfirmed
        ? `Your appointment at <strong style="color:#f59e0b;">${d.businessName}</strong> has been confirmed. See you there!`
        : `Your appointment at <strong style="color:#f59e0b;">${d.businessName}</strong> has been cancelled.`;
    return layout(title, `
    <div style="display:inline-block;background:${accent}20;border:1px solid ${accent}40;border-radius:6px;padding:4px 12px;margin-bottom:20px;">
      <span style="font-size:13px;font-weight:600;color:${accent};text-transform:uppercase;letter-spacing:0.5px;">${status}</span>
    </div>
    <h1 style="margin:0 0 8px;font-size:24px;color:#f3f4f6;">${title}</h1>
    <p style="margin:0 0 4px;font-size:15px;color:#9ca3af;">
      Hi <strong style="color:#e5e7eb;">${d.clientName}</strong>, ${message}
    </p>
    ${summaryTable(d)}
  `);
}
// ─── Public send functions ─────────────────────────────────────────────────
async function sendBookingCreated(d) {
    const resend = getResend();
    if (!resend)
        return; // skip silently if RESEND_API_KEY not set
    await Promise.all([
        resend.emails.send({
            from: FROM,
            to: d.clientEmail,
            subject: `Booking received — ${d.businessName}`,
            html: bookingCreatedClientHtml(d),
        }),
        resend.emails.send({
            from: FROM,
            to: d.ownerEmail,
            subject: `New booking: ${d.clientName} — ${formatDate(d.date)}`,
            html: bookingCreatedOwnerHtml(d),
        }),
    ]);
}
async function sendBookingStatusUpdate(d, status) {
    const resend = getResend();
    if (!resend)
        return; // skip silently if RESEND_API_KEY not set
    const subject = status === "confirmed"
        ? `Booking confirmed — ${d.businessName}`
        : `Booking cancelled — ${d.businessName}`;
    await resend.emails.send({
        from: FROM,
        to: d.clientEmail,
        subject,
        html: bookingStatusHtml(d, status),
    });
}
