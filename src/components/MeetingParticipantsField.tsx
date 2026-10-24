import type { UserAccount } from '../lib/api';

interface MeetingParticipantsFieldProps {
  users: UserAccount[];
  selectedUserIds: string[];
  onSelectedUserIdsChange: (userIds: string[]) => void;
  externalNames: string[];
  onExternalNamesChange: (names: string[]) => void;
  internalLabel?: string;
  externalLabel?: string;
}

export function getParticipantSelection(
  displayNames: string[],
  storedUserIds: string[] | undefined,
  storedExternalNames: string[] | undefined,
  users: UserAccount[],
) {
  if (storedUserIds !== undefined || storedExternalNames !== undefined) {
    return {
      userIds: storedUserIds || [],
      externalNames: storedExternalNames || [],
    };
  }

  const byName = new Map<string, string>();
  for (const user of users) {
    for (const value of [user.name, user.username, user.email]) {
      if (value.trim()) byName.set(value.trim().toLocaleLowerCase('id-ID'), user.id);
    }
  }

  const userIds = new Set<string>();
  const externalNames: string[] = [];
  for (const name of displayNames) {
    const userId = byName.get(name.trim().toLocaleLowerCase('id-ID'));
    if (userId) userIds.add(userId);
    else if (name.trim()) externalNames.push(name.trim());
  }

  return { userIds: [...userIds], externalNames };
}

export function MeetingParticipantsField({
  users,
  selectedUserIds,
  onSelectedUserIdsChange,
  externalNames,
  onExternalNamesChange,
  internalLabel = 'Peserta internal',
  externalLabel = 'Tamu / peserta eksternal',
}: MeetingParticipantsFieldProps) {
  const activeUsers = users.filter((user) => user.active).sort((a, b) => a.name.localeCompare(b.name, 'id'));
  const retainedInactiveIds = selectedUserIds.filter((id) => !users.some((user) => user.id === id));
  const inactiveUsers = users.filter((user) => !user.active && selectedUserIds.includes(user.id));
  const selectedInactiveUsers = [...new Map([...inactiveUsers, ...retainedInactiveIds.map((id) => ({ id, name: 'Pengguna sebelumnya' }))].map((user) => [user.id, user])).values()];

  const toggleUser = (userId: string, checked: boolean) => {
    if (checked) {
      if (!selectedUserIds.includes(userId) && selectedUserIds.length < 50) {
        onSelectedUserIdsChange([...selectedUserIds, userId]);
      }
      return;
    }
    onSelectedUserIdsChange(selectedUserIds.filter((id) => id !== userId));
  };

  return (
    <fieldset className="flex min-w-0 flex-col gap-3 rounded-xl border border-slate-200 bg-slate-50/60 p-3.5 sm:col-span-2">
      <legend className="px-1 text-xs font-semibold text-slate-700">Peserta rapat</legend>
      <div className="flex flex-col gap-2">
        <p className="text-[11px] font-medium text-slate-600">{internalLabel}</p>
        <div className="grid max-h-40 grid-cols-1 gap-1 overflow-y-auto rounded-lg border border-slate-200 bg-white p-2 sm:grid-cols-2">
          {activeUsers.length ? activeUsers.map((user) => (
            <label key={user.id} className="flex min-w-0 cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs text-slate-700 hover:bg-slate-50">
              <input
                type="checkbox"
                checked={selectedUserIds.includes(user.id)}
                onChange={(event) => toggleUser(user.id, event.target.checked)}
                className="size-3.5 shrink-0 accent-amber-600"
              />
              <span className="min-w-0 truncate">{user.name}</span>
              <span className="ml-auto shrink-0 text-[10px] text-slate-400">{user.role}</span>
            </label>
          )) : <p className="px-2 py-2 text-xs text-slate-500">Belum ada pengguna aktif.</p>}
          {selectedInactiveUsers.map((user) => (
            <label key={user.id} className="flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-xs text-slate-500">
              <input type="checkbox" checked disabled className="size-3.5 shrink-0 accent-amber-600" />
              <span className="min-w-0 truncate">{user.name} · nonaktif</span>
            </label>
          ))}
        </div>
        <p className="text-[10px] text-slate-500">Pilih sampai 50 pengguna internal.</p>
      </div>
      <label className="flex flex-col gap-1.5">
        <span className="text-[11px] font-medium text-slate-600">{externalLabel}</span>
        <textarea
          rows={2}
          maxLength={3000}
          value={externalNames.join('\n')}
          onChange={(event) => onExternalNamesChange(event.target.value.split(/[\n,;]/).map((name) => name.trim()).filter(Boolean).slice(0, 50))}
          placeholder={'Satu nama per baris, atau pisahkan dengan koma'}
          className="w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-amber-500 focus:ring-2 focus:ring-amber-100"
        />
      </label>
    </fieldset>
  );
}
