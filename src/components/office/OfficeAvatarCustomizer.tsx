import { useEffect } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";

import {
  AVATAR_APPEARANCE_CONTROLS,
  avatarAppearanceLabel,
  type OwnerAvatarAppearance,
  type OwnerAvatarAppearanceKey,
} from "../employee-floor/avatarAppearance";
import { OwnerAvatarPreviewCanvas } from "../employee-floor/OwnerAvatarPreviewCanvas";

export function OfficeAvatarCustomizer({
  open,
  appearance,
  ownerName,
  onCycle,
  onNameChange,
  onClose,
}: {
  open: boolean;
  appearance: OwnerAvatarAppearance;
  ownerName: string;
  onCycle: (key: OwnerAvatarAppearanceKey, direction: -1 | 1) => void;
  onNameChange: (name: string) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, open]);

  if (!open) {
    return null;
  }

  return (
    <div
      className="office-modal-scrim avatar-scrim"
      role="presentation"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section
        className="office-avatar-customizer"
        role="dialog"
        aria-modal="true"
        aria-label="Customize avatar"
      >
        <div className="office-create-modal-header">
          <strong>Avatar</strong>
          <button className="icon-button" title="Close" onClick={onClose}>
            <X size={14} />
          </button>
        </div>
        <div className="office-avatar-name-row">
          <span>Name</span>
          <input
            value={ownerName}
            onChange={(event) => onNameChange(event.target.value)}
            placeholder="You"
            aria-label="Your name"
          />
        </div>
        <div className="office-avatar-stage">
          <button
            className="avatar-stage-arrow"
            title="Previous outfit"
            onClick={() => onCycle("outfitStyle", -1)}
          >
            <ChevronLeft size={22} />
          </button>
          <OwnerAvatarPreviewCanvas appearance={appearance} ownerName={ownerName} />
          <button
            className="avatar-stage-arrow"
            title="Next outfit"
            onClick={() => onCycle("outfitStyle", 1)}
          >
            <ChevronRight size={22} />
          </button>
        </div>
        <div className="office-avatar-options">
          {AVATAR_APPEARANCE_CONTROLS.map((control) => (
            <div className="office-avatar-option" key={control.key}>
              <span>{control.label}</span>
              <button
                className="icon-button"
                title={`Previous ${control.label.toLowerCase()}`}
                onClick={() => onCycle(control.key, -1)}
              >
                <ChevronLeft size={15} />
              </button>
              <strong>{avatarAppearanceLabel(control.key, appearance[control.key])}</strong>
              <button
                className="icon-button"
                title={`Next ${control.label.toLowerCase()}`}
                onClick={() => onCycle(control.key, 1)}
              >
                <ChevronRight size={15} />
              </button>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
