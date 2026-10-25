"use client";

type Props = {
  checked: boolean;
  disabled?: boolean;
  onChange: () => void;
  label?: string;
};

export function ModernToggle({ checked, disabled=false, onChange, label }: Props) {
  return <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={label ?? (checked ? "ປິດໃຊ້" : "ເປີດໃຊ້")}
    className={`modern-toggle-v22 ${checked ? "is-on" : ""}`}
    disabled={disabled}
    onClick={onChange}
  >
    <span className="modern-toggle-track-v22"><i /></span>
    <span className="modern-toggle-label-v22">{checked ? "ເປີດ" : "ປິດ"}</span>
  </button>;
}
