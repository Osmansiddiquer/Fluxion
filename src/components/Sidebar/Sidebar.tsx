import { useStore } from '../../store/useStore';
import EntryRow from './EntryRow';
import './Sidebar.css';

export default function Sidebar({ open = false }: { open?: boolean }) {
  const entries = useStore((s) => s.entries);
  const addEntry = useStore((s) => s.addEntry);
  const width = useStore((s) => s.sidebarWidth);

  return (
    <aside className={`sidebar${open ? ' sidebar-open' : ''}`} style={{ width }}>
      <div className="sidebar-scroll">
        {entries.map((e, i) => (
          <EntryRow key={e.id} entry={e} index={i} />
        ))}
        <button className="add-entry" onClick={addEntry}>
          <span className="add-plus">+</span> Add expression
        </button>
      </div>
    </aside>
  );
}
