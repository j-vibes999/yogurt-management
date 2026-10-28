export function RouteLoading({ compact = false }: { compact?: boolean }) {
  return (
    <div className="page route-loading-v41" role="status" aria-live="polite" aria-label="ກຳລັງໂຫຼດຂໍ້ມູນ">
      <span className="visually-hidden">ກຳລັງໂຫຼດຂໍ້ມູນ</span>
      <div className="route-loading-header-v41" aria-hidden="true">
        <span className="skeleton-v41 eyebrow-v41" />
        <span className="skeleton-v41 title-v41" />
        <span className="skeleton-v41 copy-v41" />
      </div>
      <div className={`route-loading-grid-v41 ${compact ? "is-compact" : ""}`} aria-hidden="true">
        <span className="skeleton-v41 card-v41" />
        <span className="skeleton-v41 card-v41" />
        <span className="skeleton-v41 card-v41" />
      </div>
      <div className="route-loading-panel-v41" aria-hidden="true">
        <span className="skeleton-v41 line-v41 wide" />
        <span className="skeleton-v41 line-v41" />
        <span className="skeleton-v41 line-v41 short" />
      </div>
    </div>
  );
}
