import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface StaffLogoutConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clearToken: () => void;
  logoutEverywhere?: () => Promise<void>;
}

export function StaffLogoutConfirmDialog({
  open,
  onOpenChange,
  clearToken,
  logoutEverywhere,
}: StaffLogoutConfirmDialogProps) {
  const [logoutBusy, setLogoutBusy] = useState(false);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (logoutBusy) return;
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-md" data-testid="dialog-staff-logout-confirm">
        <DialogHeader>
          <DialogTitle>Log out of staff tools?</DialogTitle>
          <DialogDescription asChild>
            <div className="space-y-3 text-sm text-muted-foreground">
              <p>
                Logging out ends your staff session and hides editing tools until you sign in again.
                Unpublished drafts and content files on disk are not deleted.
              </p>
              <p>
                <span className="font-medium text-foreground">This browser</span> only signs you out here.
                Other devices or browsers stay signed in.
              </p>
              {logoutEverywhere ? (
                <p>
                  <span className="font-medium text-foreground">Everywhere</span> revokes every staff
                  session for your account on all devices. Use this if you shared a device or think a
                  session may still be open elsewhere.
                </p>
              ) : null}
            </div>
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="outline"
            disabled={logoutBusy}
            onClick={() => onOpenChange(false)}
            data-testid="button-staff-logout-cancel"
          >
            Cancel
          </Button>
          {logoutEverywhere ? (
            <Button
              type="button"
              variant="outline"
              className="text-destructive hover:text-destructive"
              disabled={logoutBusy}
              onClick={() => {
                setLogoutBusy(true);
                void logoutEverywhere().finally(() => {
                  setLogoutBusy(false);
                  onOpenChange(false);
                });
              }}
              data-testid="button-staff-logout-everywhere"
            >
              {logoutBusy ? <RefreshCw className="h-4 w-4 animate-spin mr-2" /> : null}
              Sign out everywhere
            </Button>
          ) : null}
          <Button
            type="button"
            variant="destructive"
            disabled={logoutBusy}
            onClick={() => {
              clearToken();
              onOpenChange(false);
            }}
            data-testid="button-staff-logout-this-browser"
          >
            Log out this browser
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
