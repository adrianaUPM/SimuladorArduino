import { useApp } from '../state/store';
import { IconMax, IconMin, IconSwap } from './Icons';

/** Botones de maximizar / intercambiar lado de un panel en la vista dividida */
export function PaneControls({ pane }: { pane: 'code' | 'circuit' }) {
  const view = useApp((s) => s.view);
  const maximized = useApp((s) => s.maximized);
  const setMaximized = useApp((s) => s.setMaximized);
  const codeSide = useApp((s) => s.codeSide);
  const setCodeSide = useApp((s) => s.setCodeSide);
  if (view !== 'split') return null;
  const isMax = maximized === pane;
  return (
    <>
      {!maximized && (
        <button
          className="btn sm icon"
          title="Intercambiar lados (código a la izquierda / derecha)"
          onClick={() => setCodeSide(codeSide === 'left' ? 'right' : 'left')}
        >
          <IconSwap size={14} />
        </button>
      )}
      <button
        className="btn sm icon"
        title={isMax ? 'Restaurar vista dividida' : 'Maximizar este panel'}
        onClick={() => setMaximized(isMax ? null : pane)}
      >
        {isMax ? <IconMin size={14} /> : <IconMax size={14} />}
      </button>
    </>
  );
}
