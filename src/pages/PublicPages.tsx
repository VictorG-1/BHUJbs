type PublicPage = "landing" | "register" | "itinerary" | "broadcast" | "sponsors" | "terms";
type Language = "en" | "gu";

type PublicPageProps = {
  language: Language;
  onNavigate: (page: PublicPage) => void;
};

const eventDates = "14 November 2026 - 20 November 2026";

export function LandingPage({ language, onNavigate }: PublicPageProps) {
  const gu = language === "gu";
  return (
    <section className="public-page landing-page">
      <div className="landing-hero">
        <div className="landing-copy">
          <p className="eyebrow">Shree Kutchi Maheshwari Samaj Bhuj</p>
          <h1>{gu ? "શ્રીમદ સમૂહ ભાગવત સપ્તાહ" : "Shrimad Samuha Bhagwat Saptah"}</h1>
          <p className="landing-lede">
            {gu
              ? "ભક્તિ, સેવા અને સમૂહિક સત્સંગ માટે આપનું હાર્દિક સ્વાગત છે."
              : "A week of devotion, seva and shared satsang for the Kutchi Maheshwari community."}
          </p>
          <p className="event-date-badge">{eventDates}</p>
          <div className="button-row">
            <button className="primary" onClick={() => onNavigate("register")}>{gu ? "નોંધણી કરો" : "Register now"}</button>
            <button className="secondary" onClick={() => onNavigate("itinerary")}>{gu ? "કાર્યક્રમ જુઓ" : "View itinerary"}</button>
          </div>
        </div>
      </div>

      <div className="event-action-grid">
        <button className="event-action-card" onClick={() => onNavigate("itinerary")}>
          <span className="action-number">01</span>
          <strong>{gu ? "ઇવેન્ટ કાર્યક્રમ" : "Event itinerary"}</strong>
          <small>{gu ? "દૈનિક કાર્યક્રમ અને સત્સંગ સમય" : "Daily programme and satsang timings"}</small>
        </button>
        <button className="event-action-card" onClick={() => onNavigate("broadcast")}>
          <span className="action-number">02</span>
          <strong>{gu ? "લાઇવ પ્રસારણ" : "Event live broadcast"}</strong>
          <small>{gu ? "લાઇવ લિંક ટૂંક સમયમાં ઉપલબ્ધ થશે" : "Live link will be available soon"}</small>
        </button>
        <button className="event-action-card" onClick={() => onNavigate("sponsors")}>
          <span className="action-number">03</span>
          <strong>{gu ? "ઇવેન્ટ પ્રાયોજકો" : "Event sponsors"}</strong>
          <small>{gu ? "અમારા સેવાભાવી સહયોગીઓ" : "Our seva partners and supporters"}</small>
        </button>
      </div>
    </section>
  );
}

export function ItineraryPage({ language, onNavigate }: PublicPageProps) {
  const gu = language === "gu";
  const schedule = [
    ["14 Nov", "Opening ceremony and kalash yatra", "5:00 PM"],
    ["15 Nov", "Bhagwat katha and evening aarti", "4:00 PM"],
    ["16 Nov", "Bhagwat katha and community seva", "4:00 PM"],
    ["17 Nov", "Bhagwat katha and cultural evening", "4:00 PM"],
    ["18 Nov", "Bhagwat katha and bhajan sandhya", "4:00 PM"],
    ["19 Nov", "Bhagwat katha and maha aarti", "4:00 PM"],
    ["20 Nov", "Purnahuti, prasad and closing ceremony", "9:00 AM"]
  ];
  return (
    <section className="public-page content-page">
      <div className="section-heading">
        <p className="eyebrow">{eventDates}</p>
        <h1>{gu ? "ઇવેન્ટ કાર્યક્રમ" : "Event itinerary"}</h1>
        <p>{gu ? "વિગતવાર સમયપત્રક ટૂંક સમયમાં અપડેટ કરવામાં આવશે." : "A provisional programme is shown below. Detailed timings will be updated soon."}</p>
      </div>
      <div className="itinerary-list">
        {schedule.map(([date, title, time]) => (
          <article className="itinerary-row" key={date}>
            <strong>{date}</strong>
            <span>{title}</span>
            <small>{time}</small>
          </article>
        ))}
      </div>
      <button className="secondary page-back-button" onClick={() => onNavigate("landing")}>{gu ? "મુખ્ય પેજ" : "Back to home"}</button>
    </section>
  );
}

export function BroadcastPage({ language, onNavigate }: PublicPageProps) {
  const gu = language === "gu";
  return (
    <section className="public-page content-page">
      <div className="broadcast-placeholder">
        <span className="live-dot" />
        <p className="eyebrow">{gu ? "લાઇવ પ્રસારણ" : "Live broadcast"}</p>
        <h1>{gu ? "પ્રસારણ લિંક ટૂંક સમયમાં" : "Broadcast link coming soon"}</h1>
        <p>{gu ? "ઇવેન્ટ શરૂ થાય તે પહેલાં અહીં અધિકૃત લાઇવ સ્ટ્રીમ લિંક પ્રકાશિત કરવામાં આવશે." : "The official live stream link will be published here before the event begins."}</p>
        <button className="secondary" onClick={() => onNavigate("landing")}>{gu ? "મુખ્ય પેજ" : "Back to home"}</button>
      </div>
    </section>
  );
}

export function SponsorsPage({ language, onNavigate }: PublicPageProps) {
  const gu = language === "gu";
  return (
    <section className="public-page content-page">
      <div className="section-heading">
        <p className="eyebrow">{gu ? "સેવા અને સહયોગ" : "Seva and support"}</p>
        <h1>{gu ? "ઇવેન્ટ પ્રાયોજકો" : "Event sponsors"}</h1>
        <p>{gu ? "પ્રાયોજકોની સંપૂર્ણ યાદી ટૂંક સમયમાં પ્રકાશિત થશે." : "Our sponsor directory will be published here soon."}</p>
      </div>
      <div className="sponsor-placeholder-grid">
        {["Seva Partner", "Community Partner", "Hospitality Partner"].map((label, index) => (
          <article className="sponsor-placeholder" key={label}>
            <span>0{index + 1}</span>
            <strong>{gu ? "નામ ટૂંક સમયમાં" : label}</strong>
            <small>{gu ? "વિગતો ટૂંક સમયમાં" : "Details coming soon"}</small>
          </article>
        ))}
      </div>
      <button className="secondary page-back-button" onClick={() => onNavigate("landing")}>{gu ? "મુખ્ય પેજ" : "Back to home"}</button>
    </section>
  );
}

export function TermsPage({ language, onNavigate }: PublicPageProps) {
  const gu = language === "gu";
  return (
    <section className="public-page content-page terms-page">
      <div className="section-heading">
        <p className="eyebrow">{gu ? "માહિતી અને પારદર્શિતા" : "Information and transparency"}</p>
        <h1>{gu ? "શરતો અને નિયમો" : "Terms and Conditions"}</h1>
        <p>{gu ? "નોંધણી અને ઇવેન્ટ સંબંધિત સંચાર માટેની મહત્વપૂર્ણ માહિતી." : "Important information for registration and event communications."}</p>
      </div>
      <div className="terms-content">
        <section>
          <h2>Terms & conditions</h2>
          <p>These terms apply to registration, accommodation requests, room allocation, and event communications for Shrimad Samuha Bhagwat Saptah.</p>
          <h3>1. Registration eligibility</h3>
          <p>Registrants must provide a valid mobile number and accurate information for themselves and all members. The registrant confirms that they are authorised to submit information for the accompanying family or guests.</p>
          <h3>2. Information accuracy</h3>
          <p>Names, ages, genders, mobile numbers, pothi references, and stay dates must be correct. The event administration may contact the registrant to clarify or correct incomplete information.</p>
          <h3>3. Room allocation</h3>
          <p>Room allocation depends on the submitted details, venue capacity, gender separation, senior-citizen preference, family grouping, pothi-linked rooms, private-room inventory, and availability. An allocation shown by the system is subject to administrative verification.</p>
          <h3>4. Event dates and stay</h3>
          <p>The event stay window is 14 November 2026 through 20 November 2026. A registrant must select dates within this window. Registration does not guarantee services outside the selected or approved stay period.</p>
          <h3>5. Cancellation and changes</h3>
          <p>Cancellation can be requested through the registered mobile number and OTP-linked registration flow. Cancellation releases the associated room and pothi-linked reservation only after the system confirms the request. Changes may be subject to availability.</p>
          <h3>6. Event conduct</h3>
          <p>All attendees must follow venue rules, safety instructions, community guidelines, and directions from event volunteers. The administration may refuse or withdraw accommodation access for unsafe, disruptive, fraudulent, or unlawful conduct.</p>
          <h3>7. No transfer</h3>
          <p>Room allocations and registration codes are intended for the registered family or guests and must not be sold, transferred, or misrepresented without written approval from the event administration.</p>
          <h3>8. Service availability</h3>
          <p>The administration may correct inventory, update timings, change venues, or revise arrangements when required for safety, capacity, operational, or regulatory reasons. Confirmed updates will be communicated through the registered channels where practical.</p>
          <h3>9. Acceptance</h3>
          <p>Submitting a registration indicates acceptance of these terms and the event administration process.</p>
        </section>
        <section>
          <h2>Privacy and communications</h2>
          <h3>10. Data use</h3>
          <p>Personal information is used for identity verification, registration management, room allocation, event operations, administration, and essential support communications. Access is limited to authorised personnel and service providers supporting the event.</p>
          <h3>11. Data minimisation and retention</h3>
          <p>Only information required for the event workflow should be submitted. Records may be retained for operational, reconciliation, audit, legal, and dispute-resolution purposes, and handled according to applicable law and the organisation's data practices.</p>
          <h3>12. OTP security</h3>
          <p>OTP codes are confidential. Never share an OTP with another person. The registrant is responsible for access to the submitted mobile number and for reporting suspected misuse promptly.</p>
          <h3>13. SMS and WhatsApp consent</h3>
          <p>By providing a mobile number and requesting registration, the registrant consents to essential OTP, registration, accommodation, cancellation, and event-service messages. Message delivery may depend on the telecom operator, approved template, network availability, and provider systems.</p>
          <h3>14. Communications compliance</h3>
          <p>The following compliance and DLT details are published as provided by the communications entity. They should not be read as an independent legal certification by this application.</p>
        </section>
        <section className="compliance-note">
          <h2>Compliance and DLT details</h2>
          <p>The communications entity has provided that SMS, OTPs, and communications are intended to comply with the Digital Personal Data Protection (DPDP) Act and applicable TRAI and Telecom Ministry requirements, using an approved DLT template.</p>
          <dl>
            <dt>DLT Template ID</dt><dd>1777178722910854956</dd>
            <dt>Entity Name</dt><dd>TEAM FULLSTACK</dd>
            <dt>Entity Registration Number</dt><dd>1701178720914590159</dd>
            <dt>Approved Header</dt><dd>TFLSTK</dd>
            <dt>Header Registration Number</dt><dd>1705178722147736978</dd>
          </dl>
          <p>Header statement: Header has been registered as per TRAI TCCCPR 2018 and provisions contained in the Code of Practice (CoPs) formulated by STPL under the said Regulation.</p>
        </section>
        <section>
          <h2>15. Liability and contact</h2>
          <p>The event administration is not responsible for delays or failures caused by telecom networks, SMS providers, internet services, inaccurate information, force majeure, venue restrictions, or circumstances outside reasonable control.</p>
          <p>Questions, corrections, cancellation support, or privacy requests should be directed to the event administration through the official contact channel published for the event.</p>
          <p>These terms are intended as general event terms and should be reviewed by the organising entity and its legal adviser before production publication.</p>
        </section>
      </div>
      <button className="secondary page-back-button" onClick={() => onNavigate("landing")}>{gu ? "મુખ્ય પેજ" : "Back to home"}</button>
    </section>
  );
}

export function SiteFooter({ language, onNavigate }: PublicPageProps) {
  const gu = language === "gu";
  return (
    <footer className="site-footer">
      <div>
        <strong>Shrimad Samuha Bhagwat Saptah</strong>
        <span>Shree Kutchi Maheshwari Samaj Bhuj</span>
      </div>
      <div className="footer-links">
        <button onClick={() => onNavigate("register")}>{gu ? "નોંધણી" : "Registration"}</button>
        <button onClick={() => onNavigate("itinerary")}>{gu ? "કાર્યક્રમ" : "Itinerary"}</button>
        <button onClick={() => onNavigate("broadcast")}>{gu ? "લાઇવ" : "Live"}</button>
        <button onClick={() => onNavigate("sponsors")}>{gu ? "પ્રાયોજકો" : "Sponsors"}</button>
        <button onClick={() => onNavigate("terms")}>{gu ? "શરતો" : "Terms"}</button>
      </div>
      <small>Official event registration and information portal.</small>
    </footer>
  );
}
