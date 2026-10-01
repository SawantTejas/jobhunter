import type { PublicSnapshot,PublicStatus } from '../../shared/public-model.ts';
export interface OpportunityRepository {
  readonly editable:boolean;
  list():Promise<PublicSnapshot>;
  updateStatus(id:string,status:PublicStatus):Promise<PublicSnapshot>;
  publish():Promise<void>;
}
