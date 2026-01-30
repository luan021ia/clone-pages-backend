import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan } from 'typeorm';
import { CloneHistory } from '../../database/entities/clone-history.entity';

@Injectable()
export class CloneHistoryService {
  constructor(
    @InjectRepository(CloneHistory)
    private readonly repo: Repository<CloneHistory>,
  ) {}

  /**
   * Registra ou atualiza a data da clonagem para esta URL.
   * Uma única entrada por (userId, url): ao clonar de novo, só atualiza a data.
   */
  async create(userId: string, url: string): Promise<CloneHistory> {
    const normalized = url.trim();
    const existing = await this.repo.findOne({
      where: { userId, url: normalized },
    });
    if (existing) {
      (existing as { createdAt: Date }).createdAt = new Date();
      return this.repo.save(existing);
    }
    const entry = this.repo.create({ userId, url: normalized });
    return this.repo.save(entry);
  }

  /**
   * Lista uma entrada por URL (a mais recente) nos últimos N dias.
   * Evita repetir a mesma URL várias vezes na tela.
   */
  async findByUser(userId: string, days: number = 30): Promise<{ url: string; createdAt: Date }[]> {
    const since = new Date();
    since.setDate(since.getDate() - days);

    const items = await this.repo.find({
      where: { userId, createdAt: MoreThan(since) },
      order: { createdAt: 'DESC' },
      select: ['url', 'createdAt'],
    });

    // Uma entrada por URL: fica a de data mais recente
    const byUrl = new Map<string, Date>();
    for (const { url, createdAt } of items) {
      if (!byUrl.has(url)) byUrl.set(url, createdAt);
    }
    const list = Array.from(byUrl.entries()).map(([url, createdAt]) => ({ url, createdAt }));
    list.sort((a, b) => (b.createdAt.getTime() - a.createdAt.getTime()));
    return list;
  }
}
