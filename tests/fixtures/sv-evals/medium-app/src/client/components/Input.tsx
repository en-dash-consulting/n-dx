import * as React from "react";

export interface InputProps {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}

export function Input({ value, onChange, placeholder }: InputProps): React.ReactElement {
  return (
    <input
      type="text"
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.currentTarget.value)}
    />
  );
}
