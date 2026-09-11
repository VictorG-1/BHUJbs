import { useEffect, useMemo, useState } from "react";
import fallbackPothisData from "../data/pothis.json";
import fallbackRoomsData from "../data/rooms.json";
import { OtpPanel } from "../components/OtpPanel";
import { MemberQrCode } from "../components/MemberQrCode";
import { addFamilyMember, cancelRegistration, getMyRegistration, registerFamily, sendSmsOtp, verifySmsOtp } from "../lib/api";
import { supabase } from "../lib/supabase";
import type { FamilyMemberInput, Pothi, RegistrationResult, RoomInventory } from "../lib/types";

type RegisterTab = "yajman" | "guest";
type RegisterStage = "home" | "yajman-login" | "guest-login" | "yajman-form" | "guest-form";
type Language = "en" | "gu";

const blankMember: FamilyMemberInput = {
  name: "",
  age: 18,
  gender: "male",
  mobile: ""
};

const EVENT_START_DATE = "2026-11-13";
const EVENT_END_DATE = "2026-11-20";
const MEMBER_SESSION_KEY = "bhuj-member-session-v2";

const fallbackPothis = fallbackPothisData as Pothi[];
const fallbackRooms = (fallbackRoomsData as RoomInventory[]).map(normalizeRoomInventory);

function normalizeMobile(mobile: string) {
  const digits = mobile.replace(/\D/g, "");
  return digits.length > 10 ? digits.slice(-10) : digits;
}

function createBlankMember(overrides: Partial<FamilyMemberInput> = {}): FamilyMemberInput {
  return {
    ...blankMember,
    ...overrides
  };
}

function readMemberSession(): { mobile: string; verificationToken: string; result: RegistrationResult } | null {
  try {
    const raw = window.localStorage.getItem(MEMBER_SESSION_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw) as { mobile?: string; verificationToken?: string; result?: RegistrationResult };
    if (!saved.mobile || !saved.verificationToken || !saved.result?.family) return null;
    return saved as { mobile: string; verificationToken: string; result: RegistrationResult };
  } catch {
    return null;
  }
}

function normalizeRoomInventory(room: Partial<RoomInventory> & { capacity?: number | null }): RoomInventory {
  return {
    room_number: room.room_number ?? "",
    venue_name: room.venue_name ?? "",
    section_name: room.section_name ?? "",
    source_room_number: room.source_room_number ?? "",
    floor: room.floor ?? null,
    ac_type: room.ac_type ?? null,
    bed_count: room.bed_count ?? null,
    extra_count: room.extra_count ?? null,
    total_capacity: room.total_capacity ?? room.capacity ?? 4,
    owner_type: room.owner_type ?? "",
    linked_pothi_id: room.linked_pothi_id ?? null,
    allotment_note: room.allotment_note ?? null,
    room_type: room.room_type ?? "general_room",
    sort_order: room.sort_order ?? 9999
  };
}

const copy = {
  en: {
    eyebrow: "Registration",
    title: "Shrimad Samuha Bhagwat Saptah",
    subtitle:
      "Choose how you want to enter. Pothi Yajman can log in with the mapped mobile number, while General Guests can continue to family registration.",
    openPothis: (count: number) => `${count} of 75 pothis are still open.`,
    homeTitle: "Choose registration type",
    homeText: "Use the dedicated login first, then continue to the correct registration form.",
    yajmanCard: "Pothi Yajman Login",
    yajmanCardText: "Login with the mapped yajman mobile number, verify OTP, then add room members and private-room guests.",
    guestCard: "General Guest Login",
    guestCardText: "Enter your details, verify your mobile with OTP, then add family members for automatic room allotment. No Pothi linkage is needed for this path.",
    guestComingSoon: "Coming soon",
    addRoomMember: (count: number) => `Add room member (${count}/4)`,
    noticesTitle: "Important registration information",
    notices: [
      "Use the mobile number registered with the Pothi Yajman for Pothi room registration.",
      "OTP verification is required before continuing.",
      "A Pothi Yajman may register 1 to 4 members in the allotted Pothi room.",
      "Additional guests are placed only in linked private rooms, subject to available capacity.",
      "Stay dates must be between 13 November 2026 and 20 November 2026.",
      "Each mobile number can be used for only one registration. Existing registrations can be opened again with OTP.",
      "After registration, save the room details and downloadable QR codes for every member.",
      "Cancellation is available from the saved registration result before the event."
    ],
    continue: "Continue",
    back: "Back",
    mobile: "Mobile",
    sendOtp: "Send OTP",
    resendOtp: "Resend OTP",
    sendingOtp: "Sending OTP",
    enterOtp: "Enter OTP",
    verifyOtp: "Verify OTP",
    verifyingOtp: "Verifying OTP",
    verified: "Verified",
    yajmanLoginTitle: "Pothi Yajman login",
    yajmanLoginText:
      "Login with the same mobile number that is mapped to the Pothi Yajman contact. After OTP verification, we will show the yajman profile and room details automatically.",
    guestLoginTitle: "General Guest login",
    guestLoginText:
      "Enter your details and verify your mobile number with OTP before continuing to the guest registration form. Any valid mobile number can be used here.",
    guestOtpSent: "OTP sent to your mobile number.",
    guestOtpVerified: "Mobile number verified. Continue to the guest form.",
    guestOtpRequired: "Verify your mobile number with OTP before continuing.",
    guestNameRequired: "Enter your name before requesting OTP.",
    guestMobileRequired: "Enter your mobile number before requesting OTP.",
    yourName: "Your name",
    city: "Current city of residence",
    guestContinue: "Continue to guest form",
    loginRequired: "Login required",
    loginRequiredText: "Verify the mapped Pothi Yajman mobile number first to unlock room allotment and guest entry.",
    yajmanProfile: "Yajman profile",
    roomPortfolio: "Pothi Yajman room portfolio",
    roomPortfolioText:
      "Add 1 to 4 members for the allotted pothi room. Any additional guests will be auto-placed into the linked private rooms shown below.",
    allottedRoom: "Allotted Pothi Room",
    roomNotSynced: "This pothi room has not been synced yet.",
    exactFour: "Up to 4 members can stay here",
    linkedRooms: (count: number) => `${count} linked private room(s)`,
    privateSeats: (count: number) => `${count} additional private-room seat(s) available`,
    noLinkedRooms: "No private rooms linked to this pothi yet.",
    linkedRoomText: "Additional yajman guests will be auto-allotted across these rooms.",
    fourMembers: "Pothi room members (1 to 4)",
    additionalGuests: "Additional guests for linked private rooms",
    additionalGuestText: "These guests will be auto-allotted into the linked private rooms shown above.",
    noExtraGuests: "No extra private-room guests added yet.",
    addPrivateGuest: "Add private-room guest",
    guestRegistration: "General guest registration",
    guestRegistrationText:
      "Use this tab for self and family registration. The mobile number does not need to be linked to any Pothi or Pothi Yajman. If the same mobile number is already mapped to an existing family registration, we will show a popup instead of creating a duplicate entry.",
    autoGuestAllocation: "Automatic guest allocation",
    groundFirst: (ground: number, first: number) =>
      `General stock currently includes ${ground} ground-floor rooms and ${first} first-floor rooms before overflow.`,
    seniorGround: "Senior citizens above 70 are prioritized on the ground floor.",
    guestDetails: "Guest details",
    addGuest: "Add guest",
    complete: "Complete registration",
    saving: "Saving registration",
    clear: "Clear form",
    reservationSaved: "Reservation saved",
    registrationCode: (code: string) => `Registration code ${code}`,
    yajmanSaved: "The Pothi Yajman portfolio has been saved with the allotted room and any linked private-room allocations.",
    guestsSaved: "Guests have been allotted automatically.",
    roomSaved: "Room saved",
    cancelReservation: "Cancel reservation",
    cancellingReservation: "Cancelling reservation",
    registerAnother: "Register another",
    addMember: "Register another member",
    addMemberText: "There is still room available. Add a member to this registration.",
    memberAdded: "Member added and room allocated.",
    addingMember: "Adding member",
    alreadyRegistered: "Already registered",
    alreadyRegisteredText: "This mobile number already has a registration",
    okay: "Okay",
    memberName: (index: number) => `Member ${index + 1} name`,
    guestName: "Guest name"
  },
  gu: {
    eyebrow: "નોંધણી",
    title: "શ્રીમદ સમૂહ ભાગવત સપ્તાહ",
    subtitle:
      "પ્રવેશ માટે યોગ્ય રીત પસંદ કરો. પોથી યજમાન તેમના નોંધાયેલા મોબાઇલથી પ્રવેશ કરશે અને સામાન્ય મહેમાનો અલગ ફોર્મથી આગળ વધશે.",
    openPothis: (count: number) => `હજુ ${count} માંથી 75 પોથી ખુલ્લી છે.`,
    homeTitle: "નોંધણીનો પ્રકાર પસંદ કરો",
    homeText: "પહેલા અલગ લોગિન કરો, પછી યોગ્ય નોંધણી ફોર્મ પર આગળ વધો.",
    yajmanCard: "પોથી યજમાન લોગિન",
    yajmanCardText: "પોથી સાથે જોડાયેલ મોબાઇલથી લોગિન કરો, OTP ચકાસો અને પછી રૂમ માટેના સભ્યો ઉમેરો.",
    guestCard: "સામાન્ય મહેમાન લોગિન",
    guestCardText: "તમારી વિગતો દાખલ કરો, મોબાઇલ OTPથી ચકાસો અને પછી પરિવાર માટે ઓટો રૂમ ફાળવણીવાળા ફોર્મ પર આગળ વધો.",
    guestComingSoon: "ટૂંક સમયમાં ઉપલબ્ધ",
    addRoomMember: (count: number) => `રૂમ સભ્ય ઉમેરો (${count}/4)`,
    noticesTitle: "નોંધણી માટે મહત્વપૂર્ણ સૂચનાઓ",
    notices: [
      "પોથી રૂમ માટે પોથી યજમાન સાથે નોંધાયેલ મોબાઇલ નંબરનો ઉપયોગ કરો.",
      "આગળ વધતા પહેલા OTP ચકાસણી જરૂરી છે.",
      "પોથી યજમાન ફાળવેલા પોથી રૂમમાં 1 થી 4 સભ્યો નોંધાવી શકે છે.",
      "વધારાના મહેમાનો ઉપલબ્ધ ક્ષમતા મુજબ જોડાયેલા પ્રાઇવેટ રૂમમાં ફાળવાશે.",
      "રહેવાની તારીખ 14 નવેમ્બર 2026 થી 20 નવેમ્બર 2026 વચ્ચે હોવી જોઈએ.",
      "દરેક મોબાઇલ નંબરથી માત્ર એક નોંધણી થશે. અગાઉની નોંધણી OTPથી ફરી ખોલી શકાશે.",
      "નોંધણી પછી દરેક સભ્યની રૂમ માહિતી અને ડાઉનલોડ કરી શકાય તેવા QR કોડ સાચવો.",
      "ઇવેન્ટ પહેલા સેવ થયેલા નોંધણી પરિણામમાંથી રદ કરવાની સુવિધા ઉપલબ્ધ છે."
    ],
    continue: "આગળ વધો",
    back: "પાછા જાઓ",
    mobile: "મોબાઇલ",
    sendOtp: "OTP મોકલો",
    resendOtp: "OTP ફરી મોકલો",
    sendingOtp: "OTP મોકલી રહ્યા છીએ",
    enterOtp: "OTP દાખલ કરો",
    verifyOtp: "OTP ચકાસો",
    verifyingOtp: "OTP ચકાસી રહ્યા છીએ",
    verified: "ચકાસાયેલ",
    yajmanLoginTitle: "પોથી યજમાન લોગિન",
    yajmanLoginText:
      "પોથી યજમાનના નોંધાયેલા મોબાઇલ નંબરથી લોગિન કરો. OTP પછી યજમાન પ્રોફાઇલ અને રૂમની માહિતી આપમેળે દેખાશે.",
    guestLoginTitle: "સામાન્ય મહેમાન લોગિન",
    guestLoginText:
      "તમારી વિગતો દાખલ કરો અને મહેમાન નોંધણી ફોર્મ પર આગળ વધતા પહેલા મોબાઇલ OTPથી ચકાસો.",
    guestOtpSent: "OTP તમારા મોબાઇલ પર મોકલાયો.",
    guestOtpVerified: "મોબાઇલ ચકાસાયો. હવે મહેમાન ફોર્મ પર આગળ વધો.",
    guestOtpRequired: "આગળ વધતા પહેલા મોબાઇલ OTPથી ચકાસો.",
    guestNameRequired: "OTP મોકલતા પહેલા તમારું નામ દાખલ કરો.",
    guestMobileRequired: "OTP મોકલતા પહેલા મોબાઇલ નંબર દાખલ કરો.",
    yourName: "તમારું નામ",
    city: "હાલનું નિવાસ શહેર",
    guestContinue: "મહેમાન ફોર્મ પર આગળ વધો",
    loginRequired: "લોગિન જરૂરી છે",
    loginRequiredText: "રૂમ ફાળવણી અને મહેમાન ઉમેરવા માટે પહેલા નોંધાયેલ પોથી યજમાન મોબાઇલ OTPથી ચકાસો.",
    yajmanProfile: "યજમાન પ્રોફાઇલ",
    roomPortfolio: "પોથી યજમાન રૂમ વિગતો",
    roomPortfolioText:
      "ફાળવેલા પોથી રૂમ માટે 1 થી 4 સભ્યો ઉમેરો. વધારાના મહેમાનો જોડાયેલા પ્રાઇવેટ રૂમમાં આપમેળે ફાળવાશે.",
    allottedRoom: "ફાળવેલ પોથી રૂમ",
    roomNotSynced: "આ પોથી રૂમ હજુ સિંક થયો નથી.",
    exactFour: "અહીં વધુમાં વધુ 4 સભ્યો રહી શકે છે",
    linkedRooms: (count: number) => `${count} જોડાયેલ પ્રાઇવેટ રૂમ`,
    privateSeats: (count: number) => `${count} વધારાની બેઠક ઉપલબ્ધ`,
    noLinkedRooms: "આ પોથી માટે હજી પ્રાઇવેટ રૂમ જોડાયેલા નથી.",
    linkedRoomText: "વધારાના યજમાન મહેમાનો આ રૂમોમાં આપમેળે ફાળવાશે.",
    fourMembers: "પોથી રૂમના સભ્યો (1 થી 4)",
    additionalGuests: "જોડાયેલા પ્રાઇવેટ રૂમ માટે વધારાના મહેમાનો",
    additionalGuestText: "આ મહેમાનો ઉપર દર્શાવેલા પ્રાઇવેટ રૂમોમાં આપમેળે ફાળવાશે.",
    noExtraGuests: "હજુ વધારાના મહેમાનો ઉમેરાયેલા નથી.",
    addPrivateGuest: "પ્રાઇવેટ રૂમ મહેમાન ઉમેરો",
    guestRegistration: "સામાન્ય મહેમાન નોંધણી",
    guestRegistrationText:
      "આ ફોર્મ સ્વ અને પરિવાર નોંધણી માટે છે. જો આ મોબાઇલથી નોંધણી પહેલેથી થઈ ગઈ હોય તો નવું એન્ટ્રી બનશે નહીં અને સૂચના દેખાશે.",
    autoGuestAllocation: "આપમેળે રૂમ ફાળવણી",
    groundFirst: (ground: number, first: number) => `હાલમાં ${ground} ગ્રાઉન્ડ ફ્લોર રૂમ અને ${first} ફર્સ્ટ ફ્લોર રૂમ ઉપલબ્ધ છે.`,
    seniorGround: "70 વર્ષથી વધુ વયના વરિષ્ઠ નાગરિકોને ગ્રાઉન્ડ ફ્લોર પ્રાથમિકતા મળે છે.",
    guestDetails: "મહેમાનની વિગતો",
    addGuest: "મહેમાન ઉમેરો",
    complete: "નોંધણી પૂર્ણ કરો",
    saving: "નોંધણી સાચવી રહ્યા છીએ",
    clear: "ફોર્મ સાફ કરો",
    reservationSaved: "રિઝર્વેશન સાચવાયું",
    registrationCode: (code: string) => `નોંધણી કોડ ${code}`,
    yajmanSaved: "પોથી યજમાનની નોંધણી ફાળવેલા રૂમ અને જોડાયેલા પ્રાઇવેટ રૂમ સાથે સાચવાઈ ગઈ છે.",
    guestsSaved: "મહેમાનોને આપમેળે રૂમ ફાળવાયા છે.",
    roomSaved: "રૂમ સાચવાયો",
    cancelReservation: "રિઝર્વેશન રદ કરો",
    cancellingReservation: "રિઝર્વેશન રદ કરી રહ્યા છીએ",
    registerAnother: "ફરી નોંધણી કરો",
    addMember: "વધુ સભ્ય નોંધાવો",
    addMemberText: "રૂમમાં હજી જગ્યા ઉપલબ્ધ છે. આ નોંધણીમાં સભ્ય ઉમેરો.",
    memberAdded: "સભ્ય ઉમેરાયો અને રૂમ ફાળવાયો.",
    addingMember: "સભ્ય ઉમેરી રહ્યા છીએ",
    alreadyRegistered: "પહેલેથી નોંધાયેલ",
    alreadyRegisteredText: "આ મોબાઇલ નંબરથી નોંધણી પહેલેથી થઈ ગઈ છે",
    okay: "બરાબર",
    memberName: (index: number) => `સભ્ય ${index + 1} નામ`,
    guestName: "મહેમાનનું નામ"
  }
} as const;

type RegisterPageProps = {
  language?: Language;
};

export function RegisterPage({ language = "en" }: RegisterPageProps) {
  const t = copy[language];
  const savedMemberSession = useMemo(() => readMemberSession(), []);
  const [tab, setTab] = useState<RegisterTab>("yajman");
  const [stage, setStage] = useState<RegisterStage>("home");
  const [headName, setHeadName] = useState("");
  const [headMobile, setHeadMobile] = useState(savedMemberSession?.mobile ?? "");
  const [city, setCity] = useState("");
  const [stayFrom, setStayFrom] = useState(EVENT_START_DATE);
  const [stayTo, setStayTo] = useState(EVENT_END_DATE);
  const [yajmanRoomMembers, setYajmanRoomMembers] = useState<FamilyMemberInput[]>(
    [createBlankMember({ isHead: true })]
  );
  const [privateRoomGuests, setPrivateRoomGuests] = useState<FamilyMemberInput[]>([]);
  const [generalGuests, setGeneralGuests] = useState<FamilyMemberInput[]>([
    createBlankMember({ isHead: true })
  ]);
  const [pothis, setPothis] = useState<Pothi[]>(fallbackPothis);
  const [rooms, setRooms] = useState<RoomInventory[]>(fallbackRooms);
  const [pothiId, setPothiId] = useState<number>();
  const [loading, setLoading] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancellingMemberId, setCancellingMemberId] = useState<string | null>(null);
  const [otpSending, setOtpSending] = useState(false);
  const [otpVerifying, setOtpVerifying] = useState(false);
  const [otpRequestId, setOtpRequestId] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [verificationToken, setVerificationToken] = useState(savedMemberSession?.verificationToken ?? "");
  const [otpStatus, setOtpStatus] = useState("");
  const [otpError, setOtpError] = useState("");
  const [otpMappedPothi, setOtpMappedPothi] = useState<Pothi | null>(null);
  const [message, setMessage] = useState("");
  const [duplicateMessage, setDuplicateMessage] = useState("");
  const [result, setResult] = useState<RegistrationResult | null>(savedMemberSession?.result ?? null);
  const [sessionReady, setSessionReady] = useState(Boolean(savedMemberSession));
  const [addMemberOpen, setAddMemberOpen] = useState(false);
  const [addingMember, setAddingMember] = useState(false);
  const [addMemberMessage, setAddMemberMessage] = useState("");
  const [newMember, setNewMember] = useState<FamilyMemberInput>(createBlankMember());

  useEffect(() => {
    supabase
      .from("pothis")
      .select("id, family_id, primary_holder_name, city, co_holders, handover_name, contact_name, contact_mobile")
      .order("id")
      .then(({ data, error }) => {
        if (!error && data?.length) {
          const liveById = new Map((data as Pothi[]).map((pothi) => [pothi.id, pothi]));
          const merged = fallbackPothis.map((fallback) => ({ ...fallback, ...liveById.get(fallback.id) }));
          const extraLivePothis = (data as Pothi[]).filter((pothi) => !fallbackPothis.some((fallback) => fallback.id === pothi.id));
          setPothis([...merged, ...extraLivePothis]);
        }
      });
  }, []);

  useEffect(() => {
    const saved = savedMemberSession;
    if (!saved) {
      setSessionReady(true);
      return;
    }

    setTab(saved.result.family.registration_type === "pothi_room" ? "yajman" : "guest");
    getMyRegistration({ mobile: saved.mobile, verificationToken: saved.verificationToken })
      .then((fresh) => {
        if (fresh) setResult(fresh);
      })
      .catch(() => {
        // Keep the saved dashboard visible while the connection is unavailable.
      })
      .finally(() => setSessionReady(true));
  }, [savedMemberSession]);

  useEffect(() => {
    if (!sessionReady || !result || !verificationToken || !headMobile) return;
    window.localStorage.setItem(
      MEMBER_SESSION_KEY,
      JSON.stringify({ mobile: headMobile, verificationToken, result })
    );
  }, [headMobile, result, sessionReady, verificationToken]);

  useEffect(() => {
    supabase
      .from("rooms")
      .select("room_number, venue_name, section_name, source_room_number, floor, ac_type, bed_count, extra_count, capacity, owner_type, linked_pothi_id, allotment_note, room_type, sort_order")
      .order("sort_order")
      .then(({ data, error }) => {
        if (!error && data?.length) {
          setRooms((data as Array<RoomInventory & { capacity?: number | null }>).map(normalizeRoomInventory));
        }
      });
  }, []);

  const pothiOptions = useMemo(() => (pothis.length ? pothis : fallbackPothis), [pothis]);
  const roomInventory = useMemo(() => (rooms.length ? rooms : fallbackRooms), [rooms]);
  const matchedYajman = useMemo(() => {
    if (!verificationToken) return undefined;
    const mobile = normalizeMobile(headMobile);
    return pothiOptions.find((pothi) => normalizeMobile(pothi.contact_mobile ?? "") === mobile);
  }, [headMobile, pothiOptions, verificationToken]);
  const verifiedYajman = useMemo(
    () => matchedYajman ?? otpMappedPothi ?? undefined,
    [matchedYajman, otpMappedPothi]
  );
  const activePothi = useMemo(
    () => verifiedYajman ?? pothiOptions.find((pothi) => pothi.id === pothiId),
    [pothiId, pothiOptions, verifiedYajman]
  );
  const availableCount = useMemo(
    () => pothiOptions.filter((pothi) => !pothi.family_id).length,
    [pothiOptions]
  );
  const allottedPothiRoom = useMemo(
    () =>
      roomInventory.find(
        (room) =>
          room.owner_type === "SAMAJ" &&
          room.room_type === "pothi_room" &&
          room.linked_pothi_id === pothiId
      ),
    [pothiId, roomInventory]
  );
  const linkedPrivateRooms = useMemo(
    () =>
      roomInventory.filter(
        (room) =>
          room.owner_type === "PRIVATE" &&
          room.room_type === "private_room" &&
          room.linked_pothi_id === pothiId
      ),
    [pothiId, roomInventory]
  );
  const totalPrivateCapacity = useMemo(
    () => linkedPrivateRooms.reduce((sum, room) => sum + (room.total_capacity || 0), 0),
    [linkedPrivateRooms]
  );
  const generalRoomSummary = useMemo(() => {
    const generalRooms = roomInventory.filter((room) => room.room_type === "general_room");
    return {
      ground: generalRooms.filter((room) => room.floor === "G.F.").length,
      first: generalRooms.filter((room) => room.floor === "F.F.").length
    };
  }, [roomInventory]);
  const allocationRoomSummary = useMemo(() => {
    if (!result) return [];

    const grouped = new Map<
      string,
      { room_number: string; venue_name?: string | null; capacity: number; members: string[] }
    >();

    for (const allocation of result.allocations) {
      const existing = grouped.get(allocation.room_number) ?? {
        room_number: allocation.room_number,
        venue_name: allocation.venue_name,
        capacity: roomInventory.find((room) => room.room_number === allocation.room_number)?.total_capacity ?? 0,
        members: []
      };
      existing.capacity = existing.capacity || roomInventory.find((room) => room.room_number === allocation.room_number)?.total_capacity || 0;
      existing.members.push(allocation.member_name);
      grouped.set(allocation.room_number, existing);
    }

    return [...grouped.values()];
  }, [result, roomInventory]);

  const expandableCapacity = useMemo(() => {
    if (!result) return 0;
    const family = result.family;
    const candidateRooms = family.registration_type === "pothi_room"
      ? roomInventory.filter((room) =>
          room.linked_pothi_id === family.pothi_id &&
          (room.room_type === "pothi_room" || room.room_type === "private_room")
        )
      : family.private_room_number
        ? roomInventory.filter((room) => room.room_number === family.private_room_number)
        : [];
    const occupied = new Map<string, number>();
    for (const allocation of result.allocations) {
      occupied.set(allocation.room_number, (occupied.get(allocation.room_number) ?? 0) + 1);
    }
    return candidateRooms.reduce(
      (sum, room) => sum + Math.max(0, room.total_capacity - (occupied.get(room.room_number) ?? 0)),
      0
    );
  }, [result, roomInventory]);

  const dashboardRoomGroups = useMemo(() => {
    const groups = [
      { key: "pothi_room", title: "Pothi Room" },
      { key: "private_room", title: "Private Room" },
      { key: "other", title: "Other" }
    ];
    return groups.map((group) => ({
      ...group,
      rooms: allocationRoomSummary.filter((room) => {
        const inventory = roomInventory.find((entry) => entry.room_number === room.room_number);
        const type = inventory?.room_type ?? "other";
        return group.key === "other" ? !["pothi_room", "private_room"].includes(type) : type === group.key;
      })
    })).filter((group) => group.rooms.length);
  }, [allocationRoomSummary, roomInventory]);

  useEffect(() => {
    if (!activePothi) return;
    setHeadName(activePothi.primary_holder_name || "");
    setCity(activePothi.city || "");
    setPothiId(activePothi.id);
  }, [activePothi]);

  function resetOtpState() {
    setOtpSending(false);
    setOtpVerifying(false);
    setOtpRequestId("");
    setOtpCode("");
    setVerificationToken("");
    setOtpStatus("");
    setOtpError("");
    setOtpMappedPothi(null);
  }

  function clearMemberSession() {
    window.localStorage.removeItem(MEMBER_SESSION_KEY);
  }

  function persistMemberSession(nextResult: RegistrationResult) {
    if (!headMobile || !verificationToken) return;
    window.localStorage.setItem(
      MEMBER_SESSION_KEY,
      JSON.stringify({ mobile: headMobile, verificationToken, result: nextResult })
    );
  }

  function resetAll(nextStage: RegisterStage = "home", nextTab: RegisterTab = "yajman") {
    clearMemberSession();
    setHeadName("");
    setHeadMobile("");
    setCity("");
    setStayFrom(EVENT_START_DATE);
    setStayTo(EVENT_END_DATE);
    setPothiId(undefined);
    setYajmanRoomMembers([createBlankMember({ isHead: true })]);
    setPrivateRoomGuests([]);
    setGeneralGuests([createBlankMember({ isHead: true })]);
    resetOtpState();
    setMessage("");
    setDuplicateMessage("");
    setOtpError("");
    setResult(null);
    setTab(nextTab);
    setStage(nextStage);
  }

  function goToYajmanLogin() {
    resetAll("yajman-login", "yajman");
  }

  function goToGuestLogin() {
    resetAll("guest-login", "guest");
  }

  function updateYajmanRoomMember(index: number, patch: Partial<FamilyMemberInput>) {
    setYajmanRoomMembers((current) => current.map((member, i) => (i === index ? { ...member, ...patch } : member)));
  }

  function updatePrivateRoomGuest(index: number, patch: Partial<FamilyMemberInput>) {
    setPrivateRoomGuests((current) => current.map((member, i) => (i === index ? { ...member, ...patch } : member)));
  }

  function updateGeneralGuest(index: number, patch: Partial<FamilyMemberInput>) {
    setGeneralGuests((current) => current.map((member, i) => (i === index ? { ...member, ...patch } : member)));
  }

  async function handleSendOtp(purpose: "yajman" | "guest") {
    if (!headMobile.trim()) {
      setMessage(purpose === "yajman" ? "Enter the Pothi Yajman mobile number before requesting OTP." : t.guestMobileRequired);
      return;
    }

    if (purpose === "guest" && !headName.trim()) {
      setMessage(t.guestNameRequired);
      return;
    }

    setOtpSending(true);
    setMessage("");
    setOtpStatus("");
    setOtpError("");
    try {
      const data = await sendSmsOtp({ mobile: headMobile, purpose });
      if (!data) throw new Error("OTP provider returned an empty response.");
      if (purpose === "yajman" && data.mappedPothi) {
        setOtpMappedPothi({
          id: data.mappedPothi.id,
          primary_holder_name: data.mappedPothi.primary_holder_name ?? "",
          city: data.mappedPothi.city ?? "",
          contact_mobile: headMobile,
          family_id: null
        });
      }
      setOtpRequestId(data.requestId);
      setVerificationToken("");
      setOtpStatus(purpose === "yajman" ? "OTP sent to the Pothi Yajman mobile number." : t.guestOtpSent);
    } catch (error) {
      const nextError = error instanceof Error ? error.message : "OTP send failed.";
      setOtpError(nextError);
      setMessage(nextError);
    } finally {
      setOtpSending(false);
    }
  }

  async function handleVerifyOtp(purpose: "yajman" | "guest") {
    if (!headMobile.trim() || !otpRequestId || !otpCode.trim()) {
      setMessage("Request OTP first, then enter the code to verify.");
      return;
    }

    setOtpVerifying(true);
    setMessage("");
    setOtpError("");
    try {
      const data = await verifySmsOtp({
        mobile: headMobile,
        requestId: otpRequestId,
        otp: otpCode
      });
      if (!data) throw new Error("OTP verification returned an empty response.");

      if (purpose === "yajman") {
        const normalized = normalizeMobile(headMobile);
        const matchedPothi = otpMappedPothi ?? pothiOptions.find((pothi) => normalizeMobile(pothi.contact_mobile ?? "") === normalized);
        if (!matchedPothi) {
          setVerificationToken("");
          setOtpStatus("");
          setMessage("This mobile number is not mapped to any Pothi Yajman contact.");
          return;
        }
        setVerificationToken(data.verificationToken);
        try {
          const existing = await getMyRegistration({ mobile: headMobile, verificationToken: data.verificationToken });
          if (existing) {
            setResult(existing);
            persistMemberSession(existing);
            return;
          }
        } catch {
          // A new yajman continues into the registration form.
        }
        setHeadName(matchedPothi.primary_holder_name || "");
        setCity(matchedPothi.city || "");
        setPothiId(matchedPothi.id);
        setOtpStatus("Pothi Yajman mobile number verified.");
        setStage("yajman-form");
        return;
      }

      setVerificationToken(data.verificationToken);
      setOtpStatus(t.guestOtpVerified);
      setStage("guest-form");
      try {
        const existing = await getMyRegistration({ mobile: headMobile, verificationToken: data.verificationToken });
        if (existing) {
          setResult(existing);
          persistMemberSession(existing);
        }
      } catch {
        // Room lookup is an enhancement after OTP verification; it must not block a new registration.
      }
    } catch (error) {
      const nextError = error instanceof Error ? error.message : "OTP verification failed.";
      setOtpError(nextError);
      setMessage(nextError);
    } finally {
      setOtpVerifying(false);
    }
  }

  function handleMobileChange(value: string) {
    setHeadMobile(value);
    resetOtpState();
    if (tab === "yajman") {
      setHeadName("");
      setCity("");
      setPothiId(undefined);
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setMessage("");
    setDuplicateMessage("");

    try {
      if (tab === "yajman") {
        if (!verificationToken) {
          setMessage("Please verify the Pothi Yajman mobile number with OTP before registering.");
          setLoading(false);
          return;
        }

        const resolvedPothi = verifiedYajman;
        if (!resolvedPothi || !pothiId) {
          setMessage("This mobile number is not mapped to a valid Pothi Yajman.");
          setLoading(false);
          return;
        }

        if (!stayFrom || !stayTo) {
          setMessage("Please select the stay start and end dates.");
          setLoading(false);
          return;
        }

        const yajmanPayload = yajmanRoomMembers
          .filter((member) => member.name.trim())
          .map((member, index) => ({
            ...member,
            mobile: member.mobile || (index === 0 ? headMobile : ""),
            isHead: index === 0
          }));
        const privatePayload = privateRoomGuests
          .filter((member) => member.name.trim())
          .map((member) => ({ ...member, mobile: member.mobile || "" }));

        if (!yajmanPayload.length || yajmanPayload.length > 4) {
          setMessage("Please enter between 1 and 4 members for the allotted pothi room.");
          setLoading(false);
          return;
        }

        if (privatePayload.length > 0 && !linkedPrivateRooms.length) {
          setMessage("This pothi holder does not have linked private rooms for additional guests.");
          setLoading(false);
          return;
        }

        if (privatePayload.length > totalPrivateCapacity) {
          setMessage(`Only ${totalPrivateCapacity} private-room seats are available for this pothi holder.`);
          setLoading(false);
          return;
        }

        const data = await registerFamily({
          headName: resolvedPothi.primary_holder_name || headName,
          headMobile,
          city: resolvedPothi.city || city,
          address: "",
          verificationToken,
          registrationType: "pothi_room",
          pothiId,
          stayFrom,
          stayTo,
          pothiRoomMemberCount: yajmanPayload.length,
          members: [...yajmanPayload, ...privatePayload]
        });
        setResult(data);
        persistMemberSession(data);
        return;
      }

      const guestPayload = generalGuests
        .filter((member) => member.name.trim())
        .map((member, index) => ({
          ...member,
          mobile: member.mobile || (index === 0 ? headMobile : ""),
          isHead: index === 0
        }));

      if (!guestPayload.length) {
        setMessage("Please add at least one guest.");
        setLoading(false);
        return;
      }

      if (!stayFrom || !stayTo) {
        setMessage("Please select the stay start and end dates.");
        setLoading(false);
        return;
      }

      if (!verificationToken) {
        setMessage(t.guestOtpRequired);
        setLoading(false);
        return;
      }

      const data = await registerFamily({
        headName,
        headMobile,
        city,
        address: "",
        verificationToken,
        registrationType: "general_room",
        stayFrom,
        stayTo,
        members: guestPayload
      });
      setResult(data);
      persistMemberSession(data);
    } catch (error) {
      const nextMessage = error instanceof Error ? error.message : "Registration failed.";
      if (/already done|already registered/i.test(nextMessage)) {
        setDuplicateMessage(nextMessage);
      } else {
        setMessage(nextMessage);
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleCancellation() {
    if (!result) return;
    setCancelling(true);
    setMessage("");
    try {
      await cancelRegistration({
        familyId: result.family.id,
        registrationCode: result.family.registration_code,
        headMobile
      });
      resetAll("home", "yajman");
      setMessage("Reservation cancelled.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Cancellation failed.");
    } finally {
      setCancelling(false);
    }
  }

  async function handleMemberCancellation(memberId: string) {
    if (!result) return;
    const member = result.members.find((entry) => entry.id === memberId);
    if (!member || member.is_head) {
      setMessage("The primary member can only be removed by cancelling the full reservation.");
      return;
    }
    if (!window.confirm(`Cancel registration for ${member.name}?`)) return;

    setCancellingMemberId(memberId);
    setMessage("");
    try {
      await cancelRegistration({ familyId: result.family.id, registrationCode: result.family.registration_code, headMobile, memberId, verificationToken });
      const nextResult: RegistrationResult = {
        ...result,
        members: result.members.filter((entry) => entry.id !== memberId),
        allocations: result.allocations.filter((entry) => entry.member_id !== memberId)
      };
      setResult(nextResult);
      persistMemberSession(nextResult);
      setMessage(`${member.name} has been removed from this registration.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Member cancellation failed.");
    } finally {
      setCancellingMemberId(null);
    }
  }

  async function handleAddMember(event: React.FormEvent) {
    event.preventDefault();
    if (!result || !verificationToken || !newMember.name.trim()) return;
    setAddingMember(true);
    setAddMemberMessage("");
    try {
      await addFamilyMember({
        familyId: result.family.id,
        mobile: headMobile,
        verificationToken,
        member: { ...newMember, isHead: false }
      });
      const refreshed = await getMyRegistration({ mobile: headMobile, verificationToken });
      if (refreshed) {
        setResult(refreshed);
        persistMemberSession(refreshed);
      }
      setNewMember(createBlankMember());
      setAddMemberOpen(false);
      setAddMemberMessage(t.memberAdded);
    } catch (error) {
      setAddMemberMessage(error instanceof Error ? error.message : "Could not add the member.");
    } finally {
      setAddingMember(false);
    }
  }

  function closeResult() {
    resetAll("home", "yajman");
    setMessage("Ready for the next registration.");
  }

  function signOutMember() {
    resetAll("home", "yajman");
  }

  function renderHome() {
    return (
      <>
        <section className="registration-notices">
          <h2>{t.noticesTitle}</h2>
          <ul>{t.notices.map((notice) => <li key={notice}>{notice}</li>)}</ul>
        </section>
        <div className="auth-stage-grid">
        <article className="entry-card">
          <h2>{t.yajmanCard}</h2>
          <p>{t.yajmanCardText}</p>
          <button type="button" className="primary" onClick={goToYajmanLogin}>
            {t.continue}
          </button>
        </article>
        <article className="entry-card">
          <h2>{t.guestCard}</h2>
          <p>{t.guestCardText}</p>
          <button type="button" className="secondary" disabled>
            {t.guestComingSoon}
          </button>
        </article>
        </div>
      </>
    );
  }

  function renderYajmanLogin() {
    return (
      <div className="auth-stage">
        <div className="section-heading">
          <h2>{t.yajmanLoginTitle}</h2>
          <p>{t.yajmanLoginText}</p>
        </div>
        <div className="auth-card">
          <div className="login-grid">
            <label>
              {t.mobile}
              <input value={headMobile} onChange={(event) => handleMobileChange(event.target.value)} />
            </label>
            <OtpPanel
              labels={{
                sendOtp: t.sendOtp,
                resendOtp: t.resendOtp,
                sendingOtp: t.sendingOtp,
                enterOtp: t.enterOtp,
                verifyOtp: t.verifyOtp,
                verifyingOtp: t.verifyingOtp,
                verified: t.verified,
                verifyAgain: language === "gu" ? "ચકાસાયેલ નંબર. જરૂર પડે તો ફરી OTP ચકાસી શકો." : "Verified number. You can re-check OTP if needed."
              }}
              otpCode={otpCode}
              otpRequestId={otpRequestId}
              verificationToken={verificationToken}
              otpSending={otpSending}
              otpVerifying={otpVerifying}
              otpStatus={otpStatus}
              otpError={otpError}
              loading={loading}
              onOtpCodeChange={setOtpCode}
              onSendOtp={() => void handleSendOtp("yajman")}
              onVerifyOtp={() => void handleVerifyOtp("yajman")}
            />
          </div>
          {message ? <p className="form-message">{message}</p> : null}
          <div className="button-row">
            <button type="button" className="secondary" onClick={() => resetAll("home", "yajman")}>
              {t.back}
            </button>
          </div>
        </div>
      </div>
    );
  }

  function renderGuestLogin() {
    return (
      <div className="auth-stage">
        <div className="section-heading">
          <h2>{t.guestLoginTitle}</h2>
          <p>{t.guestLoginText}</p>
        </div>
        <div className="auth-card auth-form">
          <label>
            {t.yourName}
            <input value={headName} onChange={(event) => setHeadName(event.target.value)} required />
          </label>
          <label>
            {t.mobile}
            <input value={headMobile} onChange={(event) => handleMobileChange(event.target.value)} required />
          </label>
          <label>
            {t.city}
            <input value={city} onChange={(event) => setCity(event.target.value)} />
          </label>
          <OtpPanel
            labels={{
              sendOtp: t.sendOtp,
              resendOtp: t.resendOtp,
              sendingOtp: t.sendingOtp,
              enterOtp: t.enterOtp,
              verifyOtp: t.verifyOtp,
              verifyingOtp: t.verifyingOtp,
              verified: t.verified,
              verifyAgain: language === "gu" ? "ચકાસાયેલ નંબર. જરૂર પડે તો ફરી OTP ચકાસી શકો." : "Verified number. You can re-check OTP if needed."
            }}
            otpCode={otpCode}
            otpRequestId={otpRequestId}
            verificationToken={verificationToken}
            otpSending={otpSending}
            otpVerifying={otpVerifying}
            otpStatus={otpStatus}
            otpError={otpError}
            loading={loading}
            onOtpCodeChange={setOtpCode}
            onSendOtp={() => void handleSendOtp("guest")}
            onVerifyOtp={() => void handleVerifyOtp("guest")}
          />
          {message ? <p className="form-message">{message}</p> : null}
          <div className="button-row">
            <button type="button" className="secondary" onClick={() => resetAll("home", "guest")}>
              {t.back}
            </button>
          </div>
        </div>
      </div>
    );
  }

  function renderYajmanForm() {
    return (
      <form className="form-grid" onSubmit={submit}>
        {verifiedYajman ? (
          <div className="wide-field field-stack">
            <h2>{t.yajmanProfile}</h2>
            <div className="detail-strip">
              <strong>{verifiedYajman.primary_holder_name ?? `Pothi ${verifiedYajman.id}`}</strong>
              <span>{`Pothi ${verifiedYajman.id}`}</span>
              <span>{verifiedYajman.contact_mobile ?? headMobile}</span>
              {verifiedYajman.city ? <span>{verifiedYajman.city}</span> : null}
            </div>
          </div>
        ) : null}

        <div className="wide-field field-stack">
          <h2>{t.roomPortfolio}</h2>
          <p className="inline-note">{t.roomPortfolioText}</p>

          {!verifiedYajman ? (
            <div className="room-info-card">
              <strong>{t.loginRequired}</strong>
              <small>{t.loginRequiredText}</small>
            </div>
          ) : null}

          <div className="room-portfolio">
            {allottedPothiRoom ? (
              <article className="room-info-card">
                <strong>{t.allottedRoom}</strong>
                <span>{allottedPothiRoom.room_number}</span>
                <small>{[allottedPothiRoom.venue_name, allottedPothiRoom.section_name, allottedPothiRoom.floor].filter(Boolean).join(" | ")}</small>
                <small>{t.exactFour}</small>
              </article>
            ) : (
              <article className="room-info-card">
                <strong>{t.allottedRoom}</strong>
                <small>{t.roomNotSynced}</small>
              </article>
            )}

            <article className="room-info-card">
              <strong>{t.linkedRooms(linkedPrivateRooms.length)}</strong>
              <small>{t.privateSeats(totalPrivateCapacity)}</small>
              {linkedPrivateRooms.length ? t.linkedRoomText : t.noLinkedRooms}
            </article>
          </div>

          {linkedPrivateRooms.length ? (
            <div className="room-grid">
              {linkedPrivateRooms.map((room) => (
                <article className="room-card" key={room.room_number}>
                  <strong>{room.room_number}</strong>
                  <span>{room.total_capacity} seats</span>
                  <small>{[room.venue_name, room.section_name, room.floor].filter(Boolean).join(" | ")}</small>
                </article>
              ))}
            </div>
          ) : null}
        </div>

        <div className="wide-field date-range-grid">
          <label>
            Stay from
            <input type="date" min={EVENT_START_DATE} max={EVENT_END_DATE} value={stayFrom} onChange={(event) => setStayFrom(event.target.value)} required />
          </label>
          <label>
            Stay until
            <input type="date" min={stayFrom || EVENT_START_DATE} max={EVENT_END_DATE} value={stayTo} onChange={(event) => setStayTo(event.target.value)} required />
          </label>
        </div>

        <div className="wide-field">
          <h2>{t.fourMembers}</h2>
          {yajmanRoomMembers.map((member, index) => (
            <div className="member-row" key={index}>
              <input
                placeholder={t.memberName(index)}
                value={member.name}
                onChange={(event) => updateYajmanRoomMember(index, { name: event.target.value })}
                required
              />
              <input
                type="number"
                min={0}
                max={120}
                value={member.age}
                onChange={(event) => updateYajmanRoomMember(index, { age: Number(event.target.value) })}
                required
              />
              <select
                value={member.gender}
                onChange={(event) => updateYajmanRoomMember(index, { gender: event.target.value as FamilyMemberInput["gender"] })}
              >
                <option value="male">Male</option>
                <option value="female">Female</option>
                <option value="other">Other</option>
              </select>
              <input
                placeholder={t.mobile}
                value={member.mobile}
                onChange={(event) => updateYajmanRoomMember(index, { mobile: event.target.value })}
              />
            </div>
          ))}
          <button
            type="button"
            className="secondary add-member-button"
            onClick={() => setYajmanRoomMembers((current) => current.length < 4 ? [...current, createBlankMember()] : current)}
            disabled={yajmanRoomMembers.length >= 4}
          >
            {t.addRoomMember(yajmanRoomMembers.length)}
          </button>
        </div>

        <div className="wide-field">
          <h2>{t.additionalGuests}</h2>
          <p className="inline-note">{t.additionalGuestText}</p>
          {privateRoomGuests.length ? (
            privateRoomGuests.map((member, index) => (
              <div className="member-row" key={index}>
                <input
                  placeholder={t.guestName}
                  value={member.name}
                  onChange={(event) => updatePrivateRoomGuest(index, { name: event.target.value })}
                />
                <input
                  type="number"
                  min={0}
                  max={120}
                  value={member.age}
                  onChange={(event) => updatePrivateRoomGuest(index, { age: Number(event.target.value) })}
                />
                <select
                  value={member.gender}
                  onChange={(event) => updatePrivateRoomGuest(index, { gender: event.target.value as FamilyMemberInput["gender"] })}
                >
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                  <option value="other">Other</option>
                </select>
                <input
                  placeholder={t.mobile}
                  value={member.mobile}
                  onChange={(event) => updatePrivateRoomGuest(index, { mobile: event.target.value })}
                />
              </div>
            ))
          ) : (
            <p className="inline-note">{t.noExtraGuests}</p>
          )}
          <button
            type="button"
            className="secondary"
            onClick={() => setPrivateRoomGuests((current) => [...current, createBlankMember()])}
            disabled={!verifiedYajman || !linkedPrivateRooms.length || privateRoomGuests.length >= totalPrivateCapacity}
          >
            {t.addPrivateGuest}
          </button>
          {linkedPrivateRooms.length && privateRoomGuests.length >= totalPrivateCapacity ? (
            <small className="inline-note">All available private-room capacity has been added.</small>
          ) : null}
        </div>

        {message ? <p className="form-message">{message}</p> : null}
        <div className="wide-field button-row">
          <button className="secondary" type="button" onClick={() => resetAll("home", "yajman")} disabled={loading || cancelling}>
            {t.back}
          </button>
          <button className="primary" type="submit" disabled={loading || !verificationToken || !verifiedYajman} aria-busy={loading}>
            {loading ? <><span className="loading-spinner" aria-hidden="true" /> {t.saving}</> : t.complete}
          </button>
          <button type="button" className="secondary" onClick={() => resetAll("yajman-form", "yajman")} disabled={loading || cancelling}>
            {t.clear}
          </button>
        </div>
      </form>
    );
  }

  function renderGuestForm() {
    if (!verificationToken) {
      return (
        <div className="auth-stage">
          <div className="room-info-card">
            <strong>{t.loginRequired}</strong>
            <small>{t.guestOtpRequired}</small>
          </div>
          <div className="button-row">
            <button type="button" className="primary" onClick={() => setStage("guest-login")}>
              {t.guestLoginTitle}
            </button>
          </div>
        </div>
      );
    }

    return (
      <form className="form-grid" onSubmit={submit}>
        <label>
          {t.yourName}
          <input value={headName} onChange={(event) => setHeadName(event.target.value)} required />
        </label>
        <label>
          {t.mobile}
          <input value={headMobile} onChange={(event) => setHeadMobile(event.target.value)} required />
        </label>
        <label>
          {t.city}
          <input value={city} onChange={(event) => setCity(event.target.value)} />
        </label>

        <div className="wide-field date-range-grid">
          <label>
            Stay from
            <input type="date" min={EVENT_START_DATE} max={EVENT_END_DATE} value={stayFrom} onChange={(event) => setStayFrom(event.target.value)} required />
          </label>
          <label>
            Stay until
            <input type="date" min={stayFrom || EVENT_START_DATE} max={EVENT_END_DATE} value={stayTo} onChange={(event) => setStayTo(event.target.value)} required />
          </label>
        </div>

        <div className="wide-field field-stack">
          <h2>{t.guestRegistration}</h2>
          <p className="inline-note">{t.guestRegistrationText}</p>
          <div className="room-info-card">
            <strong>{t.autoGuestAllocation}</strong>
            <small>{t.groundFirst(generalRoomSummary.ground, generalRoomSummary.first)}</small>
            <small>{t.seniorGround}</small>
          </div>
        </div>

        <div className="wide-field">
          <h2>{t.guestDetails}</h2>
          {generalGuests.map((member, index) => (
            <div className="member-row" key={index}>
              <input
                placeholder={t.guestName}
                value={member.name}
                onChange={(event) => updateGeneralGuest(index, { name: event.target.value })}
                required
              />
              <input
                type="number"
                min={0}
                max={120}
                value={member.age}
                onChange={(event) => updateGeneralGuest(index, { age: Number(event.target.value) })}
                required
              />
              <select
                value={member.gender}
                onChange={(event) => updateGeneralGuest(index, { gender: event.target.value as FamilyMemberInput["gender"] })}
              >
                <option value="male">Male</option>
                <option value="female">Female</option>
                <option value="other">Other</option>
              </select>
              <input
                placeholder={t.mobile}
                value={member.mobile}
                onChange={(event) => updateGeneralGuest(index, { mobile: event.target.value })}
              />
            </div>
          ))}
          <button type="button" className="secondary" onClick={() => setGeneralGuests((current) => [...current, createBlankMember()])}>
            {t.addGuest}
          </button>
        </div>

        {message ? <p className="form-message">{message}</p> : null}
        <div className="wide-field button-row">
          <button className="secondary" type="button" onClick={() => resetAll("home", "yajman")} disabled={loading || cancelling}>
            {t.back}
          </button>
          <button className="primary" type="submit" disabled={loading || !verificationToken} aria-busy={loading}>
            {loading ? <><span className="loading-spinner" aria-hidden="true" /> {t.saving}</> : t.complete}
          </button>
          <button type="button" className="secondary" onClick={() => resetAll("guest-form", "guest")} disabled={loading || cancelling}>
            {t.clear}
          </button>
        </div>
      </form>
    );
  }

  if (result && sessionReady) {
    return (
      <section className="page-section member-dashboard-page" aria-labelledby="member-dashboard-title">
        <div className="member-dashboard-hero">
          <div>
            <p className="eyebrow">Bhagwat Saptah · Member portal</p>
            <h1 id="member-dashboard-title">Your stay, sorted.</h1>
            <p>Everything you need for a smooth arrival in Bhuj, from your room allocation to your event entry passes.</p>
            <div className="member-hero-location"><span aria-hidden="true">●</span> Bhuj, Gujarat <i>·</i> 13–20 November 2026</div>
          </div>
          <div className="member-hero-actions"><span className="member-hero-ref">Booking reference<br /><strong>{result.family.registration_code}</strong></span><button type="button" className="member-signout" onClick={signOutMember}>Sign out</button></div>
        </div>

        <div className="member-dashboard-meta">
          <div><span>Stay</span><strong>{result.family.stay_from || EVENT_START_DATE} – {result.family.stay_to || EVENT_END_DATE}</strong><small>Arrival to departure</small></div>
          <div><span>Guests</span><strong>{result.members.length} registered</strong><small>All members on this booking</small></div>
          <div><span>Contact mobile</span><strong>{headMobile}</strong><small>Verified for this booking</small></div>
        </div>

        <div className="member-dashboard-stats">
          <article><span className="dashboard-stat-icon">01</span><strong>{result.members.length}</strong><small>Registered members</small></article>
          <article><span className="dashboard-stat-icon">02</span><strong>{allocationRoomSummary.length}</strong><small>Rooms assigned</small></article>
          <article><span className="dashboard-stat-icon">03</span><strong>{result.family.registration_type === "pothi_room" ? "Pothi" : "Private"}</strong><small>Registration type</small></article>
        </div>

        <section className="member-dashboard-section">
          <div className="member-section-heading"><div><p className="eyebrow">Stay details</p><h2>Your room allocation</h2></div><span className="dashboard-status">Confirmed</span></div>
          <div className="dashboard-room-groups">
            {dashboardRoomGroups.length ? dashboardRoomGroups.map((group) => (
              <section className="dashboard-room-group" key={group.key}>
                <div className="panel-header-inline"><div><h3>{group.title}</h3><p>{group.rooms.length} room(s) assigned</p></div></div>
                <div className="registered-room-grid">
                  {group.rooms.map((room) => (
                    <article className="registered-room-card" key={room.room_number}>
                      <div className="registered-room-card-top"><span className="room-card-label">{group.title}</span><span className="room-capacity">{room.members.length}/{room.capacity || room.members.length}</span></div>
                      <strong>{room.room_number}</strong>
                      <span>{room.venue_name || "Venue pending"}</span>
                      <small>{room.members.join(", ")}</small>
                    </article>
                  ))}
                </div>
              </section>
            )) : <p className="empty-state">Room allocation is being synced. Please refresh in a moment.</p>}
          </div>
        </section>

        <section className="member-dashboard-section member-qr-section">
          <div className="member-section-heading"><div><p className="eyebrow">Event entry</p><h2>Member QR codes</h2><p>Download one QR code for each registered member.</p></div></div>
          <div className="member-qr-list">
            {result.members.map((member) => {
              const allocation = result.allocations.find((item) => item.member_id === member.id);
              return (
                <div className="member-qr-item" key={member.id}>
                  <MemberQrCode member={member} details={{ family_code: result.family.registration_code, venue: allocation?.venue_name ?? "", room: allocation?.room_number ?? "" }} />
                  <div className="member-qr-actions">
                    <span>{member.is_head ? "Primary member" : "Registered member"}</span>
                    {!member.is_head ? <button type="button" className="member-cancel-link" onClick={() => void handleMemberCancellation(member.id)} disabled={Boolean(cancellingMemberId) || cancelling}>{cancellingMemberId === member.id ? <><span className="loading-spinner" aria-hidden="true" /> Cancelling</> : "Cancel this member"}</button> : null}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {expandableCapacity > 0 ? (
          <section className="member-dashboard-section add-member-panel">
            <div className="member-section-heading"><div><p className="eyebrow">Room capacity</p><h2>Add another member</h2><p>{expandableCapacity} seat(s) remain available in your linked room allocation.</p></div><button type="button" className="secondary compact-button" onClick={() => setAddMemberOpen((open) => !open)}>{addMemberOpen ? "Close" : "Add member"}</button></div>
            {addMemberOpen ? (
              <form className="add-member-form" onSubmit={handleAddMember}>
                <label>{t.memberName(0)}<input value={newMember.name} onChange={(event) => setNewMember((current) => ({ ...current, name: event.target.value }))} required /></label>
                <label>Age<input type="number" min="0" max="120" value={newMember.age} onChange={(event) => setNewMember((current) => ({ ...current, age: Number(event.target.value) }))} required /></label>
                <label>Gender<select value={newMember.gender} onChange={(event) => setNewMember((current) => ({ ...current, gender: event.target.value as FamilyMemberInput["gender"] }))}><option value="male">Male</option><option value="female">Female</option><option value="other">Other</option></select></label>
                <label>Mobile (optional)<input inputMode="numeric" value={newMember.mobile} onChange={(event) => setNewMember((current) => ({ ...current, mobile: event.target.value }))} /></label>
                <button className="primary" type="submit" disabled={addingMember || !newMember.name.trim()}>{addingMember ? <><span className="loading-spinner" aria-hidden="true" /> Adding</> : "Add member"}</button>
              </form>
            ) : null}
            {addMemberMessage ? <p className="form-message">{addMemberMessage}</p> : null}
          </section>
        ) : null}

        <div className="member-dashboard-actions">
          <button type="button" className="secondary" onClick={handleCancellation} disabled={cancelling}>{cancelling ? t.cancellingReservation : t.cancelReservation}</button>
          <button type="button" className="member-text-action" onClick={signOutMember}>Sign out</button>
        </div>
      </section>
    );
  }

  return (
    <section className="page-section">
      <div className="section-heading">
        <p className="eyebrow">{t.eyebrow}</p>
        <h1>{t.title}</h1>
        <p>{t.subtitle}</p>
        <p>{t.openPothis(availableCount)}</p>
      </div>

      {stage === "home" ? renderHome() : null}
      {stage === "yajman-login" ? renderYajmanLogin() : null}
      {stage === "guest-login" ? renderGuestLogin() : null}
      {stage === "yajman-form" ? renderYajmanForm() : null}
      {stage === "guest-form" ? renderGuestForm() : null}

      {result ? (
        <section className="registration-dashboard" aria-labelledby="allocation-title">
          <div className="registration-dashboard-header">
            <div>
              <p className="eyebrow">{t.reservationSaved}</p>
              <h2 id="allocation-title">{t.registrationCode(result.family.registration_code)}</h2>
            </div>
            <div className="dashboard-stay"><span>Stay dates</span><strong>{result.family.stay_from || "-"} to {result.family.stay_to || "-"}</strong></div>
          </div>
          <p className="inline-note">
            {result.family.registration_type === "pothi_room" ? t.yajmanSaved : t.guestsSaved}
          </p>
          <div className="dashboard-summary-grid">
            <div><span>Members</span><strong>{result.members.length}</strong></div>
            <div><span>Rooms</span><strong>{allocationRoomSummary.length}</strong></div>
            <div><span>Registration</span><strong>{result.family.registration_type === "pothi_room" ? "Pothi" : "Private"}</strong></div>
          </div>

            <div className="dashboard-room-groups">
              {dashboardRoomGroups.map((group) => (
                <section className="dashboard-room-group" key={group.key}>
                  <div className="panel-header-inline"><div><h3>{group.title}</h3><p>{group.rooms.length} room(s) assigned</p></div></div>
                  <div className="registered-room-grid">
                    {group.rooms.map((room) => (
                      <article className="registered-room-card" key={room.room_number}>
                        <strong>{room.room_number}</strong>
                        <span>Capacity: {room.capacity || room.members.length}</span>
                        <small>{room.members.join(", ")}</small>
                      </article>
                    ))}
                  </div>
                </section>
              ))}
            </div>

            <div className="member-qr-list">
              <div className="panel-header-inline"><div><h3>Member QR codes</h3><p>Download and keep each member code ready for event entry.</p></div></div>
              {result.members.map((member) => {
                const allocation = result.allocations.find((item) => item.member_id === member.id);
                return <MemberQrCode key={member.id} member={member} details={{ family_code: result.family.registration_code, venue: allocation?.venue_name ?? "", room: allocation?.room_number ?? "" }} />;
              })}
            </div>

            {expandableCapacity > 0 ? (
              <div className="add-member-panel">
                <div className="panel-header-inline">
                  <div><h3>{t.addMember}</h3><p>{t.addMemberText} ({expandableCapacity} seat(s) available)</p></div>
                  <button type="button" className="secondary compact-button" onClick={() => setAddMemberOpen((open) => !open)}>
                    {addMemberOpen ? t.back : t.addMember}
                  </button>
                </div>
                {addMemberOpen ? (
                  <form className="add-member-form" onSubmit={handleAddMember}>
                    <label>{t.memberName(0)}<input value={newMember.name} onChange={(event) => setNewMember((current) => ({ ...current, name: event.target.value }))} required /></label>
                    <label>Age<input type="number" min="0" max="120" value={newMember.age} onChange={(event) => setNewMember((current) => ({ ...current, age: Number(event.target.value) }))} required /></label>
                    <label>Gender<select value={newMember.gender} onChange={(event) => setNewMember((current) => ({ ...current, gender: event.target.value as FamilyMemberInput["gender"] }))}><option value="male">Male</option><option value="female">Female</option><option value="other">Other</option></select></label>
                    <label>Mobile (optional)<input inputMode="numeric" value={newMember.mobile} onChange={(event) => setNewMember((current) => ({ ...current, mobile: event.target.value }))} /></label>
                    <button className="primary" type="submit" disabled={addingMember || !newMember.name.trim()}>{addingMember ? <><span className="loading-spinner" aria-hidden="true" /> {t.addingMember}</> : t.addMember}</button>
                  </form>
                ) : null}
                {addMemberMessage ? <p className="form-message">{addMemberMessage}</p> : null}
              </div>
            ) : null}

            <div className="button-row">
              <button type="button" className="secondary" onClick={handleCancellation} disabled={cancelling || loading}>
                {cancelling ? t.cancellingReservation : t.cancelReservation}
              </button>
              <button type="button" className="primary" onClick={closeResult} disabled={cancelling || loading}>
                {t.registerAnother}
              </button>
            </div>
        </section>
      ) : null}

      {duplicateMessage ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="duplicate-title">
          <div className="modal-card">
            <p className="eyebrow">{t.alreadyRegistered}</p>
            <h2 id="duplicate-title">{t.alreadyRegisteredText}</h2>
            <p className="inline-note">{duplicateMessage}</p>
            <div className="button-row">
              <button type="button" className="primary" onClick={() => setDuplicateMessage("")}>
                {t.okay}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
