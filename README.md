# Shree Kutchi Maheshwari Samaj Bhuj Bhagwat Saptah

Full-stack PWA for Bhagwat Saptah guest registration, pothi-based room allotment, private-room guest registration, admin reporting, exports, and WhatsApp notifications.

## Stack

- React + TypeScript + Vite PWA
- Supabase PostgreSQL, Auth, Storage-ready project structure
- Supabase Edge Functions as API routes
- OTP SMS via Combirds REST API

## What Is Included

- Guest registration by head of family
- Two registration forms
- Pothi holder room registration with exactly 4 occupants per pothi room
- Private room guest registration linked to a pothi holder
- Family member entry with age, gender and mobile
- 72 locked pothi slots for pothi room registrations
- Admin dashboard for guests, filters, pothis, rooms and CSV export

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create a Supabase project.

3. Copy `.env.example` to `.env` and set:

   ```bash
   VITE_SUPABASE_URL=
   VITE_SUPABASE_ANON_KEY=
   ```

4. Apply the database schema:

   ```bash
   supabase db push
   ```

   Or run `supabase/migrations/202604150001_initial_schema.sql` in the Supabase SQL editor.

5. Set Edge Function secrets:

   ```bash
   supabase secrets set SUPABASE_URL=...
   supabase secrets set SUPABASE_SERVICE_ROLE_KEY=...
   supabase secrets set COMBIRDS_API_KEY=...
   supabase secrets set COMBIRDS_SENDER_ID=TFLSTK
   supabase secrets set COMBIRDS_TEMPLATE_ID=...

   OTP message template:
   Dear {#var#} user, your OTP for login to https://www.teamfullstack.in/ is: {#var#}. Do not share this code with anyone. - Team Full Stack
   supabase secrets set COMBIRDS_SMS_BASE_URL=https://smsapi.edumarcsms.com
   ```

   The OTP flow uses the Combirds SMS REST API. Keep the keys only on the server side.

6. Deploy functions:

   ```bash
  supabase functions deploy register-family
  supabase functions deploy send-sms-otp
  supabase functions deploy verify-sms-otp
  supabase functions deploy send-whatsapp
  supabase functions deploy export-data
   ```

7. Run the app:

   ```bash
   npm run dev
   ```

## Admin Access

The database includes `admin_profiles`. After creating a Supabase Auth user, insert that user id:

```sql
insert into public.admin_profiles (user_id, full_name, role)
values ('AUTH_USER_UUID', 'Admin Name', 'admin');
```

The current UI is a first operational dashboard. For production, add an admin login screen and route guard around the dashboard.

## API Routes

- `register-family`: registers either a pothi room or a private room guest list, creates the room, assigns members, and sends registration WhatsApp.
- `send-whatsapp`: manual notification endpoint.
- `export-data`: CSV export for admin reporting.
- `send-sms-otp`: Combirds OTP sender for login and registration.

## Notes

- Pothi locking is enforced at the database layer. Once `families.pothi_id` is set, it cannot be changed.
- `families.auth_user_id` is optional, so you can run registration without OTP during setup.
- Each pothi row also has a unique `family_id`, preventing double assignment.
- Combirds send endpoint: `https://smsapi.edumarcsms.com`
- Combirds delivery/status host: `https://api.edumarcsms.com`
