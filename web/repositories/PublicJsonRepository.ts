import type { OpportunityRepository } from './OpportunityRepository.ts';
import type { PublicSnapshot } from '../../shared/public-model.ts';
import { validateSnapshot } from '../../shared/public-model.ts';
export class PublicJsonRepository implements OpportunityRepository {
  readonly editable=false;
  async list():Promise<PublicSnapshot>{
    const response=await fetch(`${import.meta.env.BASE_URL}data/jobs.json`,{cache:'no-store'});
    if(!response.ok)throw new Error('The published dashboard data could not be loaded. Please try refreshing.');
    const snapshot:unknown=await response.json();validateSnapshot(snapshot);return snapshot;
  }
  async updateStatus():Promise<never>{throw new Error('This published dashboard is read only.');}
  async publish():Promise<never>{throw new Error('Publish from the local dashboard.');}
}
