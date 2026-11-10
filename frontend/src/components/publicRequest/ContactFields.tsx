import { Trash2 } from 'lucide-react'
import { useId } from 'react'
import { cn } from '../../lib/cn'
import type { PublicRequestContact } from '../../services/adminApi'
import { CARD_NUMBER_DIGITS, contactFieldProblems } from '../../services/publicRequests'
import { Button } from '../ui/Button'
import { Field, Input } from '../ui/fields'

/** One responsible person in a public request: in the form at /soknad and when an admin edits a request. */
export function ContactFields({
  index,
  contact,
  showErrors,
  onChange,
  onRemove,
}: {
  index: number
  contact: PublicRequestContact
  /** After the first submit: mark the fields that are missing or invalid. */
  showErrors: boolean
  onChange: (patch: Partial<PublicRequestContact>) => void
  onRemove?: () => void
}) {
  const id = useId()
  const problems = contactFieldProblems(contact)
  const invalid = (field: keyof PublicRequestContact) => showErrors && problems[field]
  return (
    <div className="space-y-3 rounded-xl p-3 ring-1 ring-slate-200 ring-inset">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-slate-900">Person {index + 1}</span>
        {onRemove && (
          <Button size="sm" variant="ghost" onClick={onRemove} aria-label={`Fjern person ${index + 1}`}>
            <Trash2 className="size-4" /> Fjern
          </Button>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Navn" htmlFor={`${id}-name`}>
          <Input
            id={`${id}-name`}
            autoComplete="name"
            maxLength={100}
            value={contact.name}
            aria-invalid={invalid('name')}
            className={cn(invalid('name') && 'ring-red-400!')}
            onChange={(e) => onChange({ name: e.target.value })}
          />
        </Field>
        <Field label="Organisasjon" htmlFor={`${id}-org`}>
          <Input
            id={`${id}-org`}
            maxLength={120}
            value={contact.organization}
            aria-invalid={invalid('organization')}
            className={cn(invalid('organization') && 'ring-red-400!')}
            onChange={(e) => onChange({ organization: e.target.value })}
          />
        </Field>
        <Field label="Kortnummer" htmlFor={`${id}-card`} hint={`${CARD_NUMBER_DIGITS} sifre på UiB-kortet, ikke studentnummeret`}>
          <Input
            id={`${id}-card`}
            inputMode="numeric"
            maxLength={30}
            value={contact.cardNumber}
            aria-invalid={invalid('cardNumber')}
            className={cn(invalid('cardNumber') && 'ring-red-400!')}
            onChange={(e) => onChange({ cardNumber: e.target.value })}
          />
        </Field>
        <Field label="Telefonnummer" htmlFor={`${id}-phone`}>
          <Input
            id={`${id}-phone`}
            type="tel"
            autoComplete="tel"
            maxLength={30}
            value={contact.phone}
            aria-invalid={invalid('phone')}
            className={cn(invalid('phone') && 'ring-red-400!')}
            onChange={(e) => onChange({ phone: e.target.value })}
          />
        </Field>
      </div>
    </div>
  )
}
