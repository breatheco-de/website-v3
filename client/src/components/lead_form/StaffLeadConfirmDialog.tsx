import { useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Checkbox } from "@/components/ui/checkbox";

const COPY = {
  en: {
    title: "You're signed in as staff",
    body: "This lead is still sent to the CRM, but it's marked as staff/test and isn't counted in A/B test results. Tag Manager receives is_staff: true.",
    tip: "To test as a real visitor, use a private window.",
    skip: "Don't ask again this session",
    cancel: "Cancel",
    confirm: "Send test lead",
  },
  es: {
    title: "Has iniciado sesión como staff",
    body: "Este lead se envía igual al CRM, pero queda marcado como staff/prueba y no cuenta en los resultados de las pruebas A/B. Tag Manager recibe is_staff: true.",
    tip: "Para probar como un visitante real, usa una ventana privada.",
    skip: "No volver a preguntar en esta sesión",
    cancel: "Cancelar",
    confirm: "Enviar lead de prueba",
  },
} as const;

export default function StaffLeadConfirmDialog({
  locale,
  onConfirm,
  onCancel,
}: {
  locale: string;
  onConfirm: (skipForSession: boolean) => void;
  /** Also runs right after onConfirm (Radix closes the dialog), so it must only clear state. */
  onCancel: () => void;
}) {
  const [skipForSession, setSkipForSession] = useState(false);
  const copy = locale === "es" ? COPY.es : COPY.en;

  return (
    <AlertDialog open onOpenChange={(open) => !open && onCancel()}>
      <AlertDialogContent data-testid="dialog-staff-lead-confirm">
        <AlertDialogHeader>
          <AlertDialogTitle>{copy.title}</AlertDialogTitle>
          <AlertDialogDescription>{copy.body}</AlertDialogDescription>
          <AlertDialogDescription>{copy.tip}</AlertDialogDescription>
        </AlertDialogHeader>
        <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
          <Checkbox
            checked={skipForSession}
            onCheckedChange={(checked) => setSkipForSession(checked === true)}
            data-testid="checkbox-staff-lead-skip"
          />
          {copy.skip}
        </label>
        <AlertDialogFooter>
          <AlertDialogCancel data-testid="button-staff-lead-cancel">
            {copy.cancel}
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={() => onConfirm(skipForSession)}
            data-testid="button-staff-lead-confirm"
          >
            {copy.confirm}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
