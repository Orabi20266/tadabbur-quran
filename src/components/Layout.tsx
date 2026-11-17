import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import {
  BookMarked,
  BookOpen,
  BookOpenText,
  GraduationCap,
  History,
  House,
  MessagesSquare,
  Settings,
} from 'lucide-react';

const tabs = [
  { to: '/', label: 'الرئيسية', icon: House, end: true },
  { to: '/memorize', label: 'الحفظ', icon: BookOpenText },
  { to: '/tajweed', label: 'التجويد', icon: GraduationCap },
  { to: '/hadith', label: 'الحديث', icon: BookMarked },
  { to: '/ask', label: 'المحادثة', icon: MessagesSquare },
  { to: '/tafsir', label: 'التفسير', icon: BookOpen },
  { to: '/activity', label: 'السجل', icon: History },
  { to: '/settings', label: 'الإعدادات', icon: Settings },
];

export function Layout({
  children,
  chat = false,
}: {
  children: ReactNode;
  /** الصفحة تدير ارتفاعها بنفسها (محادثة تملأ الشاشة). */
  chat?: boolean;
}) {
  return (
    <div className={`app-shell${chat ? ' is-chat' : ''}`}>
      <main className="page">{children}</main>
      <nav className="tabbar" aria-label="التنقل الرئيسي">
        {tabs.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) => `tab${isActive ? ' is-active' : ''}`}
          >
            <Icon size={22} strokeWidth={1.9} aria-hidden />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
