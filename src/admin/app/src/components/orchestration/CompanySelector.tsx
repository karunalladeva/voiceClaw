import type { Company } from '@/types/orchestration';

interface Props {
  companies: Company[];
  selectedId?: string;
  onSelect: (company: Company) => void;
  onCreate: () => void;
}

export function CompanySelector({ companies, selectedId, onSelect, onCreate }: Props) {
  if (companies.length === 0) {
    return null;
  }

  return (
    <div className="flex gap-2 items-center flex-wrap">
      {companies.map(company => (
        <button
          key={company.id}
          onClick={() => onSelect(company)}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            selectedId === company.id
              ? 'bg-green-600 text-white'
              : 'bg-gray-800/50 text-gray-300 hover:bg-gray-700'
          }`}
        >
          {company.name}
        </button>
      ))}
      <button
        onClick={onCreate}
        className="px-4 py-2 bg-gray-800/50 hover:bg-gray-700 rounded-lg text-sm text-gray-400 transition-colors"
      >
        + Add Company
      </button>
    </div>
  );
}
