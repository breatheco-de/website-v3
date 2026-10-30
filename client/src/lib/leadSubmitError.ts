/**
 * Visitor-facing message for a failed lead submit. The submit throws `"<status>: <body>"`.
 * Only a CRM field message (`details.detail` / `details.message`) is shown; internal
 * webhook labels, HTML and long text fall back to the generic message.
 * With the lead outbox, only 400 / 422 rejections reach this (outages answer 200 queued).
 */
export function leadSubmitErrorMessage(rawMessage: string, locale: string): string {
  const defaultErrorMessage =
    locale === "es"
      ? "Hubo un problema al enviar tu información. Por favor intenta de nuevo."
      : "There was a problem submitting your information. Please try again.";

  const isTechnicalErrorMessage = (msg: string) =>
    /upstream webhook returned a non-2xx/i.test(msg) || /failed to deliver webhook/i.test(msg) || /failed to deliver/i.test(msg);

  const preferUserFacing = (msg: string | undefined | null): string | null => {
    if (typeof msg !== "string") return null;
    const trimmed = msg.trim();
    if (!trimmed || isTechnicalErrorMessage(trimmed)) return null;
    return trimmed;
  };

  let errorMessage = defaultErrorMessage;
  try {
    const jsonMatch = rawMessage.match(/^\d+:\s*(.+)$/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[1]) as { error?: unknown; details?: unknown };
      if (typeof parsed.details === "string") {
        if (parsed.details.includes("<!DOCTYPE") || parsed.details.includes("<html")) {
          errorMessage = defaultErrorMessage;
        } else {
          try {
            const details = JSON.parse(parsed.details) as { detail?: unknown; message?: unknown };
            const fromDetails = preferUserFacing(
              typeof details.detail === "string" ? details.detail : typeof details.message === "string" ? details.message : null,
            );
            if (fromDetails) errorMessage = fromDetails;
          } catch {
            const fromRawDetails = preferUserFacing(parsed.details);
            if (fromRawDetails) errorMessage = fromRawDetails;
          }
        }
      } else if (
        parsed.details &&
        typeof parsed.details === "object" &&
        "detail" in parsed.details &&
        typeof (parsed.details as { detail: unknown }).detail === "string"
      ) {
        const fromObj = preferUserFacing((parsed.details as { detail: string }).detail);
        if (fromObj) errorMessage = fromObj;
      }
    }
  } catch {
    // keep default
  }

  if (errorMessage.length > 200 || /<[^>]+>/.test(errorMessage)) {
    errorMessage = defaultErrorMessage;
  }
  return errorMessage;
}
