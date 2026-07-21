import { useEffect, useMemo, useState } from "react";
import fallbackPothisData from "../data/pothis.json";
import fallbackRoomsData from "../data/rooms.json";
import { OtpPanel } from "../components/OtpPanel";
import { cancelRegistration, registerFamily, sendSmsOtp, verifySmsOtp } from "../lib/api";
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

const fallbackPothis = fallbackPothisData as Pothi[];
const fallbackRooms = (fallbackRoomsData as RoomInventory[]).map(normalizeRoomInventory);

function normalizeMobile(mobile: string) {
  return mobile.replace(/\D/g, "");
}

function createBlankMember(overrides: Partial<FamilyMemberInput> = {}): FamilyMemberInput {
  return {
    ...blankMember,
    ...overrides
  };
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
    guestCardText: "Enter your details, verify your mobile with OTP, then add family members for automatic room allotment.",
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
      "Enter your details and verify your mobile number with OTP before continuing to the guest registration form.",
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
      "The first 4 members will go into the allotted pothi room. Any extra guests will be auto-placed into the linked private rooms shown below.",
    allottedRoom: "Allotted Pothi Room",
    roomNotSynced: "This pothi room has not been synced yet.",
    exactFour: "Exactly 4 members will stay here",
    linkedRooms: (count: number) => `${count} linked private room(s)`,
    privateSeats: (count: number) => `${count} additional private-room seat(s) available`,
    noLinkedRooms: "No private rooms linked to this pothi yet.",
    linkedRoomText: "Additional yajman guests will be auto-allotted across these rooms.",
    fourMembers: "4 members for the allotted pothi room",
    additionalGuests: "Additional guests for linked private rooms",
    additionalGuestText: "These guests will be auto-allotted into the linked private rooms shown above.",
    noExtraGuests: "No extra private-room guests added yet.",
    addPrivateGuest: "Add private-room guest",
    guestRegistration: "General guest registration",
    guestRegistrationText:
      "Use this tab for self and family registration. If the same mobile number is already mapped to an existing family registration, we will show a popup instead of creating a duplicate entry.",
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
      "પ્રથમ 4 સભ્યો ફાળવેલા પોથી રૂમમાં રહેશે. વધારાના મહેમાનો જોડાયેલા પ્રાઇવેટ રૂમમાં આપમેળે ફાળવાશે.",
    allottedRoom: "ફાળવેલ પોથી રૂમ",
    roomNotSynced: "આ પોથી રૂમ હજુ સિંક થયો નથી.",
    exactFour: "ચોક્કસ 4 સભ્યો અહીં રહેશે",
    linkedRooms: (count: number) => `${count} જોડાયેલ પ્રાઇવેટ રૂમ`,
    privateSeats: (count: number) => `${count} વધારાની બેઠક ઉપલબ્ધ`,
    noLinkedRooms: "આ પોથી માટે હજી પ્રાઇવેટ રૂમ જોડાયેલા નથી.",
    linkedRoomText: "વધારાના યજમાન મહેમાનો આ રૂમોમાં આપમેળે ફાળવાશે.",
    fourMembers: "ફાળવેલા પોથી રૂમ માટે 4 સભ્યો",
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
  const [tab, setTab] = useState<RegisterTab>("yajman");
  const [stage, setStage] = useState<RegisterStage>("home");
  const [headName, setHeadName] = useState("");
  const [headMobile, setHeadMobile] = useState("");
  const [city, setCity] = useState("");
  const [yajmanRoomMembers, setYajmanRoomMembers] = useState<FamilyMemberInput[]>(
    Array.from({ length: 4 }, (_value, index) => createBlankMember({ isHead: index === 0 }))
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
  const [otpSending, setOtpSending] = useState(false);
  const [otpVerifying, setOtpVerifying] = useState(false);
  const [otpRequestId, setOtpRequestId] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [verificationToken, setVerificationToken] = useState("");
  const [otpStatus, setOtpStatus] = useState("");
  const [message, setMessage] = useState("");
  const [duplicateMessage, setDuplicateMessage] = useState("");
  const [result, setResult] = useState<RegistrationResult | null>(null);

  useEffect(() => {
    supabase
      .from("pothis")
      .select("id, family_id, primary_holder_name, city, co_holders, handover_name, contact_name, contact_mobile")
      .order("id")
      .then(({ data, error }) => {
        if (!error && data?.length) setPothis(data as Pothi[]);
      });
  }, []);

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
  const activePothi = useMemo(
    () => matchedYajman ?? pothiOptions.find((pothi) => pothi.id === pothiId),
    [matchedYajman, pothiId, pothiOptions]
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
      { room_number: string; venue_name?: string | null; section_name?: string | null; floor?: string | null; members: string[] }
    >();

    for (const allocation of result.allocations) {
      const existing = grouped.get(allocation.room_number) ?? {
        room_number: allocation.room_number,
        venue_name: allocation.venue_name,
        section_name: allocation.section_name,
        floor: allocation.floor,
        members: []
      };
      existing.members.push(allocation.member_name);
      grouped.set(allocation.room_number, existing);
    }

    return [...grouped.values()];
  }, [result]);

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
  }

  function resetAll(nextStage: RegisterStage = "home", nextTab: RegisterTab = "yajman") {
    setHeadName("");
    setHeadMobile("");
    setCity("");
    setPothiId(undefined);
    setYajmanRoomMembers(Array.from({ length: 4 }, (_value, index) => createBlankMember({ isHead: index === 0 })));
    setPrivateRoomGuests([]);
    setGeneralGuests([createBlankMember({ isHead: true })]);
    resetOtpState();
    setMessage("");
    setDuplicateMessage("");
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
    try {
      const data = await sendSmsOtp({ mobile: headMobile, purpose });
      if (!data) throw new Error("OTP provider returned an empty response.");
      setOtpRequestId(data.requestId);
      setVerificationToken("");
      setOtpStatus(purpose === "yajman" ? "OTP sent to the Pothi Yajman mobile number." : t.guestOtpSent);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "OTP send failed.");
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
    try {
      const data = await verifySmsOtp({
        mobile: headMobile,
        requestId: otpRequestId,
        otp: otpCode
      });
      if (!data) throw new Error("OTP verification returned an empty response.");

      if (purpose === "yajman") {
        const normalized = normalizeMobile(headMobile);
        const matchedPothi = pothiOptions.find((pothi) => normalizeMobile(pothi.contact_mobile ?? "") === normalized);
        if (!matchedPothi) {
          setVerificationToken("");
          setOtpStatus("");
          setMessage("This mobile number is not mapped to any Pothi Yajman contact.");
          return;
        }
        setVerificationToken(data.verificationToken);
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
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "OTP verification failed.");
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

        if (!matchedYajman || !pothiId) {
          setMessage("This mobile number is not mapped to a valid Pothi Yajman.");
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

        if (yajmanPayload.length < 4) {
          setMessage("Please enter all 4 members for the allotted pothi room.");
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
          headName: matchedYajman.primary_holder_name || headName,
          headMobile,
          city: matchedYajman.city || city,
          address: "",
          verificationToken,
          registrationType: "pothi_room",
          pothiId,
          members: [...yajmanPayload, ...privatePayload]
        });
        setResult(data);
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
        members: guestPayload
      });
      setResult(data);
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

  function closeResult() {
    resetAll("home", "yajman");
    setMessage("Ready for the next registration.");
  }

  function renderHome() {
    return (
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
          <button type="button" className="primary" onClick={goToGuestLogin}>
            {t.continue}
          </button>
        </article>
      </div>
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
                verified: t.verified
              }}
              otpCode={otpCode}
              otpRequestId={otpRequestId}
              verificationToken={verificationToken}
              otpSending={otpSending}
              otpVerifying={otpVerifying}
              otpStatus={otpStatus}
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
              verified: t.verified
            }}
            otpCode={otpCode}
            otpRequestId={otpRequestId}
            verificationToken={verificationToken}
            otpSending={otpSending}
            otpVerifying={otpVerifying}
            otpStatus={otpStatus}
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
        {matchedYajman ? (
          <div className="wide-field field-stack">
            <h2>{t.yajmanProfile}</h2>
            <div className="detail-strip">
              <strong>{matchedYajman.primary_holder_name ?? `Pothi ${matchedYajman.id}`}</strong>
              <span>{`Pothi ${matchedYajman.id}`}</span>
              <span>{matchedYajman.contact_mobile ?? headMobile}</span>
              {matchedYajman.city ? <span>{matchedYajman.city}</span> : null}
            </div>
          </div>
        ) : null}

        <div className="wide-field field-stack">
          <h2>{t.roomPortfolio}</h2>
          <p className="inline-note">{t.roomPortfolioText}</p>

          {!matchedYajman ? (
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
            disabled={!linkedPrivateRooms.length}
          >
            {t.addPrivateGuest}
          </button>
        </div>

        {message ? <p className="form-message">{message}</p> : null}
        <div className="wide-field button-row">
          <button className="secondary" type="button" onClick={() => resetAll("home", "yajman")} disabled={loading || cancelling}>
            {t.back}
          </button>
          <button className="primary" type="submit" disabled={loading || !matchedYajman}>
            {loading ? t.saving : t.complete}
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
          <button className="primary" type="submit" disabled={loading || !verificationToken}>
            {loading ? t.saving : t.complete}
          </button>
          <button type="button" className="secondary" onClick={() => resetAll("guest-form", "guest")} disabled={loading || cancelling}>
            {t.clear}
          </button>
        </div>
      </form>
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
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="allocation-title">
          <div className="modal-card">
            <p className="eyebrow">{t.reservationSaved}</p>
            <h2 id="allocation-title">{t.registrationCode(result.family.registration_code)}</h2>
            <p className="inline-note">
              {result.family.registration_type === "pothi_room" ? t.yajmanSaved : t.guestsSaved}
            </p>

            <div className="room-portfolio">
              {allocationRoomSummary.map((room) => (
                <article className="room-info-card" key={room.room_number}>
                  <strong>{room.room_number}</strong>
                  <span>{room.members.length} guest(s)</span>
                  <small>{[room.venue_name, room.section_name, room.floor].filter(Boolean).join(" | ")}</small>
                  <small>{room.members.join(", ")}</small>
                </article>
              ))}
            </div>

            <div className="allocation-list">
              {result.allocations.map((allocation) => (
                <article className="allocation-item" key={allocation.member_id}>
                  <strong>{allocation.member_name}</strong>
                  <span>{allocation.room_number}</span>
                  <small>
                    {[allocation.venue_name, allocation.section_name, allocation.floor].filter(Boolean).join(" | ") || t.roomSaved}
                  </small>
                </article>
              ))}
            </div>

            <div className="button-row">
              <button type="button" className="secondary" onClick={handleCancellation} disabled={cancelling || loading}>
                {cancelling ? t.cancellingReservation : t.cancelReservation}
              </button>
              <button type="button" className="primary" onClick={closeResult} disabled={cancelling || loading}>
                {t.registerAnother}
              </button>
            </div>
          </div>
        </div>
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
