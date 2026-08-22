export type Gender = "male" | "female" | "other";
export type RegistrationType = "pothi_room" | "private_room" | "general_room";

export type FamilyMemberInput = {
  name: string;
  age: number;
  gender: Gender;
  mobile: string;
  isHead?: boolean;
};

export type RegisterFamilyInput = {
  headName: string;
  headMobile: string;
  city: string;
  address: string;
  verificationToken?: string;
  registrationType: RegistrationType;
  pothiId?: number;
  relatedPothiId?: number;
  privateRoomNumber?: string;
  stayFrom: string;
  stayTo: string;
  members: FamilyMemberInput[];
};

export type SendOtpResult = {
  requestId: string;
  expiresAt: string;
  sent: boolean;
  smsSubmitted?: boolean;
  mappedPothi?: {
    id: number;
    primary_holder_name?: string | null;
    city?: string | null;
  };
};

export type VerifyOtpResult = {
  verified: boolean;
  verificationToken: string;
};

export type RegisteredMember = {
  id: string;
  name: string;
};

export type RegistrationResult = {
  family: {
    id: string;
    registration_code: string;
    registration_type: RegistrationType;
    room_number: string | null;
    stay_from?: string | null;
    stay_to?: string | null;
  };
  members: RegisteredMember[];
  allocations: {
    member_id: string;
    member_name: string;
    room_number: string;
    venue_name?: string | null;
    section_name?: string | null;
    floor?: string | null;
  }[];
};

export type Pothi = {
  id: number;
  family_id: string | null;
  primary_holder_name?: string | null;
  city?: string | null;
  co_holders?: string[];
  handover_name?: string | null;
  contact_name?: string | null;
  contact_mobile?: string | null;
};

export type RoomInventory = {
  room_number: string;
  venue_name: string;
  section_name: string;
  source_room_number: string;
  floor: string | null;
  ac_type: string | null;
  bed_count: number | null;
  extra_count: number | null;
  total_capacity: number;
  owner_type: string;
  linked_pothi_id: number | null;
  allotment_note: string | null;
  room_type: RegistrationType;
  sort_order: number;
};

export type AdminMemberRow = {
  id: string;
  name: string;
  age: number;
  gender: Gender;
  mobile: string | null;
  is_head: boolean;
  families: {
    id: string;
    head_name: string;
    head_mobile: string;
    city: string | null;
    wants_stay: boolean;
    pothi_id: number | null;
    reference_pothi_id: number | null;
    registration_type: RegistrationType;
    private_room_number: string | null;
  } | null;
  room_allocations: {
    rooms: { room_number: string; venue_name?: string | null; section_name?: string | null } | null;
  }[];
};
