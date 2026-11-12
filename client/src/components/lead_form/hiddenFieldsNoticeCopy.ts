/** Staff copy for the edit-mode hidden fields notice and status badges (en / es). */
import type { LeadFormHiddenReason } from "@/components/lead_form/hiddenFieldPriority";
import type {
  LeadFormAutoDefaultSource,
  LeadFormFieldSourceKind,
} from "@/components/lead_form/resolveLeadFormFieldValues";
import type { SignupGateErrorCode } from "@/components/lead_form/signupGateStatus";
import type { HiddenFieldsNoticeLocale, SignupValueSource } from "@/components/lead_form/hiddenFieldsNoticeTypes";

type Copy = Record<HiddenFieldsNoticeLocale, string>;

const t = (locale: HiddenFieldsNoticeLocale, copy: Copy) => copy[locale] ?? copy.en;

export const NOTICE_COPY = {
  title: { en: "Hidden fields sent with this form", es: "Campos ocultos que envía este formulario" },
  otherFields: (n: number): Copy => ({ en: `Other fields (${n})`, es: `Otros campos (${n})` }),
  otherFieldsTitle: { en: "Other hidden values", es: "Otros valores ocultos" },
  otherFieldsDescription: {
    en: "Everything else this form sends that visitors don't see or type.",
    es: "Todo lo demás que envía este formulario y que el visitante no ve ni escribe.",
  },
  valueLabel: { en: "Value sent", es: "Valor enviado" },
  nothingSent: { en: "Nothing will be sent", es: "No se enviará nada" },
  stillLoading: { en: "Still loading…", es: "Cargando…" },
  sourceLabel: { en: "Comes from", es: "Viene de" },
  whyHidden: { en: "Why it's hidden", es: "Por qué está oculto" },
  otherSources: { en: "Other sources checked", es: "Otras fuentes revisadas" },
  emptyCandidate: { en: "empty", es: "vacío" },
  winner: { en: "used", es: "usado" },
  viewerNote: {
    en: "This is your value. Visitors get their own.",
    es: "Este es tu valor. Cada visitante recibe el suyo.",
  },
  viaFormState: {
    en: "Copied into the form when the page loaded.",
    es: "Se copió al formulario al cargar la página.",
  },
  programMapped: (raw: string): Copy => ({
    en: `Picked "${raw}", sent as its catalog id.`,
    es: `Se eligió "${raw}" y se envía con su id de catálogo.`,
  }),
  signupGroup: {
    en: "Sent to signup when a guest submits (Consumer Auth field map)",
    es: "Se envía al registro cuando un invitado envía (mapa de campos de Consumer Auth)",
  },
  signupKeyLabel: (key: string): Copy => ({ en: `Signup: ${key}`, es: `Registro: ${key}` }),
  close: { en: "Close", es: "Cerrar" },
  cancel: { en: "Cancel", es: "Cancelar" },
  closeConfirmTitle: { en: "Close this notice?", es: "¿Cerrar este aviso?" },
  closeConfirmBody: {
    en: "You can reopen it from the \"Hidden fields\" chip above the form.",
    es: "Puedes volver a abrirlo con el botón \"Campos ocultos\" sobre el formulario.",
  },
  hideForSession: { en: "Don't show again this session", es: "No mostrar más en esta sesión" },
  reopenChip: (n: number): Copy => ({ en: `Hidden fields (${n})`, es: `Campos ocultos (${n})` }),
} satisfies Record<string, Copy | ((...args: never[]) => Copy)>;

const SOURCE_COPY: Record<LeadFormFieldSourceKind, Copy> = {
  form_state: { en: "Prefilled on load", es: "Prellenado al cargar" },
  signed_in_profile: { en: "The signed-in account", es: "La cuenta con sesión iniciada" },
  page_single_location: { en: "The page's only campus", es: "La única sede de la página" },
  page_single_region: { en: "The page's only region", es: "La única región de la página" },
  visitor_location: { en: "Detected from your location", es: "Detectado de tu ubicación" },
  visitor_region: { en: "Region detected from your location", es: "Región detectada de tu ubicación" },
  program_page_catalog: { en: "This program page (catalog id)", es: "Esta página de programa (id de catálogo)" },
  program_page: { en: "This program page", es: "Esta página de programa" },
  url_coupon: { en: "The link's ?coupon= parameter", es: "El parámetro ?coupon= del enlace" },
  url_referral_key: { en: "The link's ?referral_key= parameter", es: "El parámetro ?referral_key= del enlace" },
  url_referral: { en: "The link's ?referral= parameter", es: "El parámetro ?referral= del enlace" },
  url_ref: { en: "The link's ?ref= parameter", es: "El parámetro ?ref= del enlace" },
  configured_default: { en: "Set in the form settings", es: "Configurado en el formulario" },
  configured_default_literal: {
    en: "The form settings say \"auto\" but nothing was found, so the word \"auto\" is sent",
    es: "El formulario dice \"auto\" pero no se encontró nada, así que se envía la palabra \"auto\"",
  },
};

const AUTO_COPY: Record<LeadFormAutoDefaultSource, Copy> = {
  program_page: { en: "auto: this program page", es: "auto: esta página de programa" },
  page_single_location: { en: "auto: the page's only campus", es: "auto: la única sede de la página" },
  page_single_region: { en: "auto: the page's only region", es: "auto: la única región de la página" },
  visitor_location: { en: "auto: your detected location", es: "auto: tu ubicación detectada" },
  visitor_region: { en: "auto: your detected region", es: "auto: tu región detectada" },
  url_coupon: { en: "auto: the link's ?coupon=", es: "auto: el ?coupon= del enlace" },
  url_referral: {
    en: "auto: the link's ?referral_key=, ?referral= or ?ref=",
    es: "auto: el ?referral_key=, ?referral= o ?ref= del enlace",
  },
  none: { en: "auto: nothing found", es: "auto: no se encontró nada" },
};

const HIDDEN_REASON_COPY: Record<LeadFormHiddenReason, Copy> = {
  builtin_default: {
    en: "Hidden by default. Turn it on in the form's fields to show it.",
    es: "Oculto por defecto. Actívalo en los campos del formulario para mostrarlo.",
  },
  yaml: { en: "Set to hidden in the form's fields.", es: "Marcado como oculto en los campos del formulario." },
  signed_in_profile: {
    en: "Hidden because the signed-in account already has it.",
    es: "Oculto porque la cuenta con sesión iniciada ya lo tiene.",
  },
  single_source_option: {
    en: "Hidden because its list has only one option, which is picked automatically.",
    es: "Oculto porque su lista tiene una sola opción, que se elige sola.",
  },
  source_no_options: {
    en: "Hidden because its list has no options.",
    es: "Oculto porque su lista no tiene opciones.",
  },
  landing_location: {
    en: "Hidden because this page has only one campus.",
    es: "Oculto porque esta página tiene una sola sede.",
  },
  collapsed_after_login: {
    en: "Optional field hidden once a signed-in visitor has filled the required fields.",
    es: "Campo opcional que se oculta cuando un visitante con sesión llenó los obligatorios.",
  },
  extra_key: {
    en: "Extra value sent with the form. It has no input on screen.",
    es: "Valor extra que envía el formulario. No tiene campo en pantalla.",
  },
};

const SIGNUP_SOURCE_COPY: Record<SignupValueSource, (path: string) => Copy> = {
  form: (p) => ({ en: `The hidden form field "${p}"`, es: `El campo oculto "${p}"` }),
  session: (p) => ({ en: `The visitor's session (${p})`, es: `La sesión del visitante (${p})` }),
  constant: () => ({ en: "A fixed value in Consumer Auth settings", es: "Un valor fijo en Consumer Auth" }),
  global: (p) => ({ en: `The site global ${p}`, es: `La variable global ${p}` }),
};

export const GATE_COPY = {
  gated: { en: "Signup Gated", es: "Registro requerido" },
  loginGated: { en: "Login Gated", es: "Login requerido" },
  activeBody: {
    en: "Guests must create an account before this form sends their details. Visitors with an account can log in instead, and signed-in visitors skip the fields their account already has.",
    es: "Los invitados deben crear una cuenta antes de que este formulario envíe sus datos. Quien ya tiene cuenta puede iniciar sesión, y los visitantes con sesión no ven los campos que su cuenta ya tiene.",
  },
  loginOnlyBody: {
    en: "Only login is offered. Guests must log in with an existing account before the form sends. No new accounts are created.",
    es: "Solo se ofrece iniciar sesión. Los invitados deben entrar con una cuenta existente antes de enviar. No se crean cuentas nuevas.",
  },
  loadingBody: { en: "Checking the signup settings…", es: "Revisando la configuración de registro…" },
  errorTitle: { en: "Signup gate isn't working", es: "El registro requerido no funciona" },
  errorNotRunning: {
    en: "Until this is fixed, the form sends the lead without creating an account.",
    es: "Hasta corregirlo, el formulario envía el lead sin crear una cuenta.",
  },
  errorStillRuns: {
    en: "Signup still runs, but it may fail for visitors.",
    es: "El registro sigue corriendo, pero puede fallar para los visitantes.",
  },
  technical: { en: "Details", es: "Detalles" },
} satisfies Record<string, Copy>;

const GATE_ERROR_COPY: Record<SignupGateErrorCode, Copy> = {
  settings_unavailable: {
    en: "The Consumer Auth settings could not be loaded.",
    es: "No se pudo cargar la configuración de Consumer Auth.",
  },
  not_configured: {
    en: "Signup isn't set up for this site. Fix it in Settings → Consumer Auth.",
    es: "El registro no está configurado en este sitio. Corrígelo en Settings → Consumer Auth.",
  },
  field_map_empty: {
    en: "The signup field map is empty. Add mappings in Settings → Consumer Auth.",
    es: "El mapa de campos de registro está vacío. Agrega campos en Settings → Consumer Auth.",
  },
  form_fields: {
    en: "This form is missing a field the signup field map needs. Fix it in the form's fields or in Settings → Consumer Auth.",
    es: "A este formulario le falta un campo que pide el mapa de registro. Corrígelo en los campos del formulario o en Settings → Consumer Auth.",
  },
};

export const OVERRIDE_COPY = {
  badge: (n: number): Copy => ({ en: `Override ${n} active`, es: `Override ${n} activo` }),
  body: (n: number): Copy => ({
    en: `Override ${n} in this form's overrides matches right now, so the form uses these settings instead:`,
    es: `El override ${n} de este formulario coincide ahora, así que el formulario usa estos ajustes:`,
  }),
  conversion_name: { en: "Conversion", es: "Conversión" },
  tags: { en: "Tags", es: "Tags" },
  automations: { en: "Automations", es: "Automatizaciones" },
  webhook: { en: "Webhook", es: "Webhook" },
  success: { en: "After submit", es: "Después de enviar" },
  messages: { en: "Form copy changes", es: "Cambia los textos del formulario" },
  other: { en: "Other settings", es: "Otros ajustes" },
  viewerNote: {
    en: "This override checks who is viewing. Visitors may see a different result.",
    es: "Este override revisa quién está viendo. Otros visitantes pueden ver otro resultado.",
  },
} satisfies Record<string, Copy | ((n: number) => Copy)>;

export function noticeText(locale: HiddenFieldsNoticeLocale, copy: Copy): string {
  return t(locale, copy);
}

export function sourceText(
  locale: HiddenFieldsNoticeLocale,
  source: LeadFormFieldSourceKind,
  auto?: LeadFormAutoDefaultSource,
): string {
  if (source === "configured_default" && auto) return t(locale, AUTO_COPY[auto]);
  return t(locale, SOURCE_COPY[source]);
}

export function hiddenReasonText(locale: HiddenFieldsNoticeLocale, reason: LeadFormHiddenReason): string {
  return t(locale, HIDDEN_REASON_COPY[reason]);
}

export function signupSourceText(
  locale: HiddenFieldsNoticeLocale,
  source: SignupValueSource,
  path = "",
): string {
  return t(locale, SIGNUP_SOURCE_COPY[source](path));
}

export function gateErrorText(locale: HiddenFieldsNoticeLocale, code: SignupGateErrorCode): string {
  return t(locale, GATE_ERROR_COPY[code]);
}
