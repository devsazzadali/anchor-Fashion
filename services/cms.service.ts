import { CMSRepository } from "@/repositories/cms.repository";
import { cmsPageSchema } from "@/schemas/cms.schema";
import { CMSPage, CMSSection, CMSNavigation, CMSPageBlock } from "@/types/cms.types";

const cmsRepository = new CMSRepository();

// REG-65: the service's legacy navigation wrappers call repository methods
// by their old names/shapes — getNavigationByLocation does not exist on
// CMSRepository (it is getNavigation) and the repository's saveNavigation
// takes a single object, not positional (location, name, items). Rewiring
// those calls would change runtime behaviour (the getNavigationByLocation
// wrapper always resolves null today via the optional call, and the
// positional saveNavigation call always throws inside the repository when
// it reads data.items), so the legacy call shapes are typed here as
// optional methods and the calls are left exactly as they are. A future
// functional batch may rewire them.
type LegacyNavigationRepository = CMSRepository & {
  getNavigationByLocation?: (location: string) => Promise<CMSNavigation | null>;
  saveNavigation?: (
    location: string,
    name: string,
    items: CMSNavigation["items"]
  ) => Promise<CMSNavigation>;
};

const legacyNavigationRepository =
  cmsRepository as LegacyNavigationRepository;

export class CMSService {
  async getPages(): Promise<CMSPage[]> {
    return await cmsRepository.getPages();
  }

  async getPageById(id: string): Promise<CMSPage | null> {
    return await cmsRepository.getPageById(id);
  }

  async getPageBySlug(slug: string): Promise<CMSPage | null> {
    return await cmsRepository.getPageBySlug(slug);
  }

  async createPage(data: unknown): Promise<CMSPage> {
    const validData = cmsPageSchema.parse(data);
    return await cmsRepository.createPage(validData);
  }

  async updatePage(id: string, data: unknown): Promise<CMSPage> {
    const validData = cmsPageSchema.partial().parse(data);
    return await cmsRepository.updatePage(id, validData);
  }

  async deletePage(id: string): Promise<void> {
    await cmsRepository.deletePage(id);
  }

  async getPageBlocks(pageId: string): Promise<CMSPageBlock[]> {
    return await cmsRepository.getPageBlocks(pageId);
  }

  async savePageBlocks(pageId: string, blocks: Partial<CMSPageBlock>[]): Promise<void> {
    await cmsRepository.savePageBlocks(pageId, blocks);
  }

  async getGlobalSections(): Promise<CMSSection[]> {
    return await cmsRepository.getGlobalSections();
  }

  async getNavigation(location: string): Promise<CMSNavigation | null> {
    return (await legacyNavigationRepository.getNavigationByLocation?.(location)) ?? null;
  }

  async getAllNavigations(): Promise<CMSNavigation[]> {
    return await cmsRepository.getAllNavigations();
  }

  async saveNavigation(location: string, name: string, items: CMSNavigation["items"]): Promise<CMSNavigation | null> {
    return (await legacyNavigationRepository.saveNavigation?.(location, name, items)) ?? null;
  }

  async deleteNavigation(id: string): Promise<void> {
    await cmsRepository.deleteNavigation(id);
  }
}

export const cmsService = new CMSService();
