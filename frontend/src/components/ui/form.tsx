"use client";
import * as CheckboxP from "@radix-ui/react-checkbox";
import * as SelectP from "@radix-ui/react-select";
import * as SwitchP from "@radix-ui/react-switch";
import { Check, ChevronDown, Eye, EyeOff } from "lucide-react";
import { forwardRef, useId, useState, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from "react";
import { useT } from "@/lib/providers";
import { cn, formatPhoneInput } from "@/lib/utils";
import { IconButton } from "./button";

const fieldBase =
  "w-full rounded-lg border border-border-strong bg-surface text-fg placeholder:text-fg-3 transition-colors focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15 disabled:opacity-60 aria-[invalid=true]:border-danger";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(function Input({ className, invalid, ...p }, ref) {
  return <input ref={ref} aria-invalid={invalid || undefined} className={cn(fieldBase, "h-11 px-3 text-base md:h-10 md:text-sm", className)} {...p} />;
});
/** Every password box in the product: a show/hide toggle sits inside the field. */
export const PasswordInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(function PasswordInput({ className, ...p }, ref) {
  const [shown, setShown] = useState(false);
  const { t } = useT();
  return (
    <div className="relative">
      <Input ref={ref} type={shown ? "text" : "password"} spellCheck={false} className={cn("pr-11", className)} {...p} />
      <IconButton label={shown ? t.common.hidePassword : t.common.showPassword} aria-pressed={shown} size="icon-sm" className="absolute right-1 top-1/2 -translate-y-1/2 active:-translate-y-1/2" onClick={() => setShown((v) => !v)}>{shown ? <EyeOff /> : <Eye />}</IconButton>
    </div>
  );
});
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }>(function Textarea({ className, invalid, ...p }, ref) {
  return <textarea ref={ref} aria-invalid={invalid || undefined} className={cn(fieldBase, "min-h-24 px-3 py-2.5 text-base md:text-sm", className)} {...p} />;
});
export function Field({ label, error, hint, children, className }: { label?: ReactNode; error?: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <label className="block space-y-1.5">
        {label && <span className="block text-[13px] font-medium text-fg">{label}</span>}
        {children}
      </label>
      {error ? <p role="alert" className="text-[13px] text-danger">{error}</p> : hint ? <p className="text-[13px] text-fg-3">{hint}</p> : null}
    </div>
  );
}
export const PhoneInput = forwardRef<HTMLInputElement, Omit<InputHTMLAttributes<HTMLInputElement>, "onChange" | "value"> & { value: string; onChange: (v: string) => void; invalid?: boolean }>(function PhoneInput({ value, onChange, ...p }, ref) {
  return <Input ref={ref} type="tel" inputMode="tel" autoComplete="tel" placeholder="0712 345 678" value={value} onChange={(e) => onChange(formatPhoneInput(e.target.value))} {...p} />;
});
export type Option = { value: string; label: ReactNode };
export function Select({ value, onChange, options, placeholder, className, label, disabled }: { value?: string; onChange: (v: string) => void; options: Option[]; placeholder?: string; className?: string; label?: string; disabled?: boolean }) {
  return (
    <SelectP.Root value={value || undefined} onValueChange={(v) => onChange(v === "__all" ? "" : v)} disabled={disabled}>
      <SelectP.Trigger aria-label={label} className={cn(fieldBase, "flex h-11 items-center justify-between gap-2 px-3 text-left text-sm md:h-10", className)}>
        <span className="truncate"><SelectP.Value placeholder={placeholder ?? "Select"} /></span>
        <SelectP.Icon><ChevronDown className="size-4 text-fg-3" /></SelectP.Icon>
      </SelectP.Trigger>
      <SelectP.Portal>
        <SelectP.Content position="popper" sideOffset={4} className="z-[60] max-h-72 min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-lg border bg-surface shadow-lg">
          <SelectP.Viewport className="p-1">
            {options.map((o) => (
              <SelectP.Item key={o.value} value={o.value || "__all"} className="flex min-h-10 cursor-pointer items-center justify-between gap-3 rounded-md px-2.5 text-sm outline-none data-[highlighted]:bg-surface-2">
                <SelectP.ItemText>{o.label}</SelectP.ItemText>
                <SelectP.ItemIndicator><Check className="size-4 text-primary-ink" /></SelectP.ItemIndicator>
              </SelectP.Item>
            ))}
          </SelectP.Viewport>
        </SelectP.Content>
      </SelectP.Portal>
    </SelectP.Root>
  );
}
export function Switch({ checked, onChange, label, description, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; description?: ReactNode; disabled?: boolean }) {
  const id = useId();
  const control = (
    <SwitchP.Root id={id} checked={checked} onCheckedChange={onChange} disabled={disabled} aria-label={typeof label === "string" ? label : undefined}
      className="relative h-6 w-10 shrink-0 rounded-full bg-surface-3 transition-colors data-[state=checked]:bg-primary disabled:opacity-50">
      <SwitchP.Thumb className="block size-5 translate-x-0.5 rounded-full bg-white shadow-sm transition-transform duration-150 data-[state=checked]:translate-x-[18px]" />
    </SwitchP.Root>
  );
  if (!label) return control;
  return (
    <div className="flex min-h-11 items-center justify-between gap-4">
      <label htmlFor={id} className="min-w-0 cursor-pointer">
        <span className="block text-sm font-medium">{label}</span>
        {description && <span className="block text-[13px] text-fg-3">{description}</span>}
      </label>
      {control}
    </div>
  );
}
export function Checkbox({ checked, onChange, label }: { checked: boolean | "indeterminate"; onChange: (v: boolean) => void; label: string }) {
  return (
    <CheckboxP.Root checked={checked} onCheckedChange={(v) => onChange(v === true)} aria-label={label}
      className="grid size-[18px] place-items-center rounded-[5px] border border-border-strong bg-surface data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=indeterminate]:border-primary data-[state=indeterminate]:bg-primary">
      <CheckboxP.Indicator className="text-primary-fg"><Check className="size-3.5" strokeWidth={3} /></CheckboxP.Indicator>
    </CheckboxP.Root>
  );
}
