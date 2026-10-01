import { Component, type ReactNode } from 'react';

/** Evita la página en blanco: muestra el error y permite borrar los datos locales */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error(error);
  }

  private reset = () => {
    try {
      Object.keys(localStorage)
        .filter((k) => k.startsWith('esp32sim:'))
        .forEach((k) => localStorage.removeItem(k));
    } catch {
      /* sin almacenamiento */
    }
    location.reload();
  };

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div style={{ display: 'grid', placeItems: 'center', height: '100%', padding: 24 }}>
        <div className="modal" style={{ padding: 24 }}>
          <h2 style={{ margin: '0 0 8px', fontSize: 16 }}>Algo ha fallado al cargar el simulador</h2>
          <p className="muted" style={{ color: 'var(--fg-muted)', lineHeight: 1.5 }}>
            Puede deberse a un proyecto guardado en este navegador con una versión anterior. Puedes recargar o
            restablecer los datos locales (se borrarán los proyectos guardados en este navegador).
          </p>
          <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, color: 'var(--err)', background: 'var(--panel-2)', padding: 10, borderRadius: 8 }}>
            {this.state.error.message}
          </pre>
          <div className="row" style={{ marginTop: 12 }}>
            <button className="btn outline" onClick={() => location.reload()}>
              Recargar
            </button>
            <button className="btn primary" onClick={this.reset}>
              Restablecer datos locales
            </button>
          </div>
        </div>
      </div>
    );
  }
}
