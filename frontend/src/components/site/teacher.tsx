"use client";
import { Award, GraduationCap, MessageCircle } from "lucide-react";
import { Avatar, Badge } from "@/components/ui/display";
import { useSite, useT } from "@/lib/providers";
import type { Teacher } from "@/lib/types";
import { whatsappLink } from "@/lib/utils";

function Links({ whatsapp, social }: { whatsapp: string; social: Record<string, string> }) {
  const { t } = useT();
  const rows = Object.entries(social).filter(([, url]) => url);
  if (!whatsapp && !rows.length) return null;
  return (
    <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm font-medium">
      {whatsapp && <a href={whatsappLink(whatsapp)} target="_blank" rel="noreferrer" className="inline-flex min-h-9 items-center gap-1.5 text-primary-ink"><MessageCircle className="size-4" aria-hidden />{t.home.whatsapp}</a>}
      {rows.map(([name, url]) => <a key={name} href={url} target="_blank" rel="noreferrer" className="inline-flex min-h-9 items-center capitalize text-fg-2 hover:text-fg">{name}</a>)}
    </div>
  );
}

/** Shown on the home page, and in Settings as the live preview. */
export function TeacherProfile({ teacher, whatsapp, social }: { teacher: Teacher; whatsapp: string; social: Record<string, string> }) {
  const { t } = useT();
  return (
    <div data-testid="teacher" className="flex flex-wrap gap-5 rounded-2xl border bg-surface p-5 shadow-sm md:gap-8 md:p-8">
      <Avatar name={teacher.name} src={teacher.photo_url} className="size-24 text-2xl md:size-32 md:text-3xl" />
      <div className="min-w-[min(16rem,100%)] flex-1">
        <h3 className="text-xl font-semibold tracking-tight md:text-2xl">{teacher.name}</h3>
        {teacher.title && <p className="text-fg-2">{teacher.title}</p>}
        {teacher.bio && <p className="mt-3 whitespace-pre-line font-serif text-[17px] leading-relaxed">{teacher.bio}</p>}
        {(teacher.years != null || teacher.credentials) && (
          <ul className="mt-4 space-y-1.5 text-sm text-fg-2">
            {teacher.years != null && <li className="flex items-center gap-2"><GraduationCap className="size-4 shrink-0 text-fg-3" aria-hidden />{t.home.years(teacher.years)}</li>}
            {teacher.credentials && <li className="flex items-center gap-2"><Award className="size-4 shrink-0 text-fg-3" aria-hidden />{teacher.credentials}</li>}
          </ul>
        )}
        {teacher.subjects.length > 0 && <div className="mt-4 flex flex-wrap gap-1.5" aria-label={t.home.subjectsTaught}>{teacher.subjects.map((s) => <Badge key={s}>{s}</Badge>)}</div>}
        <Links whatsapp={whatsapp} social={social} />
      </div>
    </div>
  );
}

export function MeetTeacher() {
  const site = useSite();
  if (!site.teacher.name) return null;
  return <TeacherProfile teacher={site.teacher} whatsapp={site.contact_whatsapp} social={site.social_links} />;
}

/** The compact card at the end of every lesson. */
export function AuthorCard() {
  const site = useSite();
  const { t } = useT();
  const teacher = site.teacher;
  if (!teacher.name) return null;
  return (
    <aside data-testid="author-card" aria-label={t.home.author} className="mt-10 flex items-start gap-3.5 rounded-xl border bg-surface p-4 shadow-sm">
      <Avatar name={teacher.name} src={teacher.photo_url} className="size-14 text-base" />
      <div className="min-w-0">
        <div className="text-[13px] font-medium text-fg-3">{t.home.author}</div>
        <div className="font-semibold tracking-tight">{teacher.name}</div>
        {teacher.title && <div className="text-sm text-fg-2">{teacher.title}</div>}
        {teacher.bio && <p className="mt-1.5 line-clamp-3 text-sm leading-relaxed text-fg-2">{teacher.bio}</p>}
      </div>
    </aside>
  );
}
