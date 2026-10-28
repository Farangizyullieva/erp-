import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { EmployeesController } from './employees.controller';
import { EmployeesService } from './employees.service';
import { RolesController } from './roles.controller';
import { RolesService } from './roles.service';

@Module({
  controllers: [AuthController, EmployeesController, RolesController],
  providers: [AuthService, EmployeesService, RolesService],
})
export class IdentityModule {}
