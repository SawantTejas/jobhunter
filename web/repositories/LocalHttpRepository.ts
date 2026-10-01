import type { OpportunityRepository } from './OpportunityRepository.ts';
import type { PublicSnapshot,PublicStatus } from '../../shared/public-model.ts';
import { validateSnapshot } from '../../shared/public-model.ts';
export class LocalHttpRepository implements OpportunityRepository {
  readonly editable=true;
  private async request(path:string,method='GET',body?:unknown):Promise<unknown>{
    const response=await fetch(`/_local/${path}`,{method,headers:{'X-JobHunter-Local':'1','Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),cache:'no-store'});
    const value=await response.json();if(!response.ok)throw new Error(value.error??'Local update failed');return value;
  }
  async list():Promise<PublicSnapshot>{const value=await this.request('opportunities');validateSnapshot(value);return value;}
  async updateStatus(id:string,status:PublicStatus):Promise<PublicSnapshot>{const value=await this.request(`opportunities/${encodeURIComponent(id)}/status`,'PATCH',{status});validateSnapshot(value);return value;}
  async publish():Promise<void>{await this.request('publish','POST',{});}
}
