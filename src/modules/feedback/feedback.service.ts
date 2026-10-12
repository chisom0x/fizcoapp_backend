import { Injectable } from '@nestjs/common';
import { FeedbackRepository } from './feedback.repository';
import { CreateFeedbackDto } from './dto/create-feedback.dto';

@Injectable()
export class FeedbackService {
  constructor(private readonly feedbackRepository: FeedbackRepository) {}

  async submit(userId: string, dto: CreateFeedbackDto) {
    return this.feedbackRepository.create(userId, dto.rating, dto.comment);
  }
}
