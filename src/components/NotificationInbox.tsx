import { useEffect, useRef, useState } from 'react';
import useSWR from 'swr';
import { Bell, Check, CheckCheck, X } from 'lucide-react';
import { api, type AppNotification } from '../lib/api';

interface NotificationInboxProps {
  userId: string;
}

function formatNotificationDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

export function NotificationInbox({ userId }: NotificationInboxProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const { data, error, isLoading, mutate } = useSWR<AppNotification[]>(
    `notifications:${userId}`,
    () => api.getNotifications(),
    { refreshInterval: isOpen ? 30_000 : 0, revalidateOnFocus: true }
  );
  const notifications = data || [];
  const unreadCount = notifications.filter((notification) => !notification.readAt).length;

  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !containerRef.current?.contains(event.target)) setIsOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false);
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const markRead = async (notificationId: string) => {
    setActionError(null);
    setIsSaving(true);
    try {
      await api.markNotificationRead(notificationId);
      await mutate();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'Notifikasi gagal diperbarui.');
    } finally {
      setIsSaving(false);
    }
  };

  const markAllRead = async () => {
    setActionError(null);
    setIsSaving(true);
    try {
      await api.markAllNotificationsRead();
      await mutate();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'Notifikasi gagal diperbarui.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => {
          if (!isOpen) void mutate();
          setIsOpen((open) => !open);
        }}
        aria-label={`Notifikasi${unreadCount ? `, ${unreadCount} belum dibaca` : ''}`}
        aria-expanded={isOpen}
        aria-controls="notification-inbox-panel"
        className="relative inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-slate-200 p-2 text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
      >
        <Bell className="size-4" aria-hidden="true" />
        {unreadCount > 0 && (
          <span aria-hidden="true" className="absolute -right-1 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-bold leading-none text-white ring-2 ring-white">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <section
          id="notification-inbox-panel"
          aria-label="Inbox notifikasi"
          className="absolute right-0 top-full z-50 mt-2 flex max-h-[min(70vh,34rem)] w-[min(22rem,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl shadow-slate-900/10"
        >
          <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-3">
            <div>
              <h2 className="text-sm font-bold text-slate-900">Notifikasi</h2>
              <p className="mt-0.5 text-[11px] text-slate-500">
                {unreadCount ? `${unreadCount} belum dibaca` : 'Semua sudah dibaca'}
              </p>
            </div>
            <div className="flex items-center gap-1">
              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={markAllRead}
                  disabled={isSaving}
                  className="inline-flex min-h-9 items-center gap-1 rounded-lg px-2 text-[11px] font-semibold text-amber-800 transition-colors hover:bg-amber-50 disabled:opacity-50"
                >
                  <CheckCheck className="size-3.5" aria-hidden="true" />
                  Baca semua
                </button>
              )}
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                aria-label="Tutup inbox notifikasi"
                className="inline-flex size-9 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900"
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            </div>
          </div>

          {actionError && <p role="alert" className="border-b border-rose-100 bg-rose-50 px-4 py-2 text-xs text-rose-800">{actionError}</p>}
          {error && <p role="alert" className="border-b border-rose-100 bg-rose-50 px-4 py-2 text-xs text-rose-800">Notifikasi gagal dimuat. Muat ulang halaman untuk mencoba kembali.</p>}
          <div className="overflow-y-auto">
            {isLoading ? (
              <p className="px-4 py-8 text-center text-xs text-slate-500">Memuat notifikasi…</p>
            ) : notifications.length === 0 ? (
              <div className="px-5 py-10 text-center">
                <Bell className="mx-auto size-6 text-slate-300" aria-hidden="true" />
                <p className="mt-2 text-xs font-semibold text-slate-700">Belum ada notifikasi</p>
                <p className="mt-1 text-[11px] text-slate-500">Catatan review SPV untuk pekerjaan Anda akan muncul di sini.</p>
              </div>
            ) : (
              <ul className="divide-y divide-slate-100">
                {notifications.map((notification) => (
                  <NotificationItem
                    key={notification.id}
                    notification={notification}
                    isSaving={isSaving}
                    onMarkRead={markRead}
                  />
                ))}
              </ul>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

function NotificationItem({
  notification,
  isSaving,
  onMarkRead,
}: {
  notification: AppNotification;
  isSaving: boolean;
  onMarkRead: (id: string) => void;
}) {
  const isUnread = !notification.readAt;

  return (
    <li className={`px-4 py-3 ${isUnread ? 'bg-amber-50/60' : 'bg-white'}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-semibold leading-5 text-slate-900">{notification.title}</p>
          <time dateTime={notification.createdAt} className="text-[10px] text-slate-500">
            {formatNotificationDate(notification.createdAt)}
          </time>
        </div>
        {isUnread && (
          <button
            type="button"
            onClick={() => onMarkRead(notification.id)}
            disabled={isSaving}
            aria-label={`Tandai notifikasi ${notification.jobId} telah dibaca`}
            title="Tandai telah dibaca"
            className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-amber-800 transition-colors hover:bg-amber-100 disabled:opacity-50"
          >
            <Check className="size-4" aria-hidden="true" />
          </button>
        )}
      </div>
      <p className="mt-2 whitespace-pre-wrap break-words text-xs leading-5 text-slate-700">{notification.message}</p>
      <p className="mt-2 text-[10px] text-slate-500">
        {notification.clientName && <><span className="font-semibold text-slate-700">Klien: {notification.clientName}</span>{' · '}</>}
        <span className="font-mono font-semibold text-slate-600">{notification.jobId}</span>
        {' · '}{notification.jobTitle}
        {' · '}Review oleh {notification.actorName}
      </p>
    </li>
  );
}
