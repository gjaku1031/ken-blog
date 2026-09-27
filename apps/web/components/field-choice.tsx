"use client";

import { useState } from "react";

/** {@link FieldChoice}의 기존 분야 선택과 새 분야 입력을 원본 폼처럼 전환한다. */
export function FieldChoice({ value, fields, onChange }: { value: string; fields: string[];
  onChange: (value: string) => void }) {
  const [adding, setAdding] = useState(false);
  return <label className="field-choice">분야{adding ? <span className="field-new">
    <input value={value} maxLength={80} required autoFocus placeholder="새 분야 이름"
      onChange={(event) => onChange(event.target.value)} />
    <button type="button" aria-label="기존 분야 선택" onClick={() => { setAdding(false); onChange(fields[0] ?? ""); }}>×</button>
  </span> : <select value={fields.includes(value) ? value : ""} required onChange={(event) => {
    if (event.target.value === "__new__") { setAdding(true); onChange(""); }
    else onChange(event.target.value);
  }}><option value="" disabled>분야 선택</option>
    {fields.map((field) => <option key={field} value={field}>{field}</option>)}
    <option value="__new__">+ 새 분야</option>
  </select>}</label>;
}
