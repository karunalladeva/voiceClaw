import { orchestrationStore, generateId } from './store';
import type { Company, CompanySettings, ActivityEvent } from './types';

const DEFAULT_SETTINGS: CompanySettings = {
  requireApprovalForHires: true,
  requireApprovalForBudgetIncrease: true,
  requireApprovalForHighPriorityTasks: false,
  requireUserApprovalForCriticalTasks: false,
  maxReworkAttempts: 3,
  defaultAgentBudgetUSD: 50,
  maxTotalBudgetUSD: 1000,
};

class CompanyManager {
  async list(): Promise<Company[]> {
    return orchestrationStore.load('companies');
  }

  async getById(id: string): Promise<Company | undefined> {
    const companies = await this.list();
    return companies.find(c => c.id === id);
  }

  async create(data: { name: string; mission: string; settings?: Partial<CompanySettings> }): Promise<Company> {
    const companies = await this.list();

    const company: Company = {
      id: generateId(),
      name: data.name,
      mission: data.mission,
      createdAt: Date.now(),
      settings: { ...DEFAULT_SETTINGS, ...data.settings },
    };

    companies.push(company);
    await orchestrationStore.save('companies', companies);

    await this.logActivity({
      companyId: company.id,
      actorId: 'system',
      actorType: 'system',
      action: 'company:created',
      entityType: 'company',
      entityId: company.id,
      data: { name: company.name },
    });

    console.log(`[Orchestration] Company created: ${company.name}`);
    return company;
  }

  async update(id: string, updates: Partial<Pick<Company, 'name' | 'mission'> & { settings: Partial<CompanySettings> }>): Promise<Company | null> {
    const companies = await this.list();
    const index = companies.findIndex(c => c.id === id);
    if (index === -1) return null;

    const company = companies[index];
    if (updates.name) company.name = updates.name;
    if (updates.mission) company.mission = updates.mission;
    if (updates.settings) {
      company.settings = { ...company.settings, ...updates.settings };
    }

    await orchestrationStore.save('companies', companies);

    await this.logActivity({
      companyId: id,
      actorId: 'system',
      actorType: 'human',
      action: 'company:updated',
      entityType: 'company',
      entityId: id,
      data: updates,
    });

    return company;
  }

  async delete(id: string): Promise<boolean> {
    const companies = await this.list();
    const filtered = companies.filter(c => c.id !== id);
    if (filtered.length === companies.length) return false;

    await orchestrationStore.save('companies', filtered);

    await this.logActivity({
      companyId: id,
      actorId: 'system',
      actorType: 'human',
      action: 'company:deleted',
      entityType: 'company',
      entityId: id,
      data: {},
    });

    return true;
  }

  private async logActivity(event: Omit<ActivityEvent, 'id' | 'timestamp'>): Promise<void> {
    await orchestrationStore.appendActivity({
      id: generateId(),
      timestamp: Date.now(),
      ...event,
    });
  }
}

export const companyManager = new CompanyManager();
