import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { DiscoveryModule, DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { IS_AUTHENTICATED, IS_PUBLIC, REQUIRED_PERMISSIONS } from '../src/common/auth/decorators';
import { ALL_PERMISSIONS } from '../src/common/auth/permissions.catalog';

// TZ 3.4: guard'siz endpoint CI'dan o'tmaydi
describe('endpoint access metadata', () => {
  it('every route declares @Public, @Authenticated or @RequirePermission with known codes', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule, DiscoveryModule] }).compile();
    const discovery = moduleRef.get(DiscoveryService);
    const scanner = new MetadataScanner();
    const reflector = new Reflector();
    const known = new Set<string>(ALL_PERMISSIONS.map((p) => p.code));
    const unguarded: string[] = [];
    let routes = 0;

    for (const wrapper of discovery.getControllers()) {
      const proto = Object.getPrototypeOf(wrapper.instance) as Record<string, (...args: unknown[]) => unknown>;
      for (const name of scanner.getAllMethodNames(proto)) {
        const handler = proto[name];
        if (!handler || Reflect.getMetadata(METHOD_METADATA, handler) === undefined) continue;
        routes++;
        const targets = [handler, wrapper.metatype as object] as Parameters<Reflector['getAllAndOverride']>[1];
        const perms = reflector.getAllAndOverride<string[] | undefined>(REQUIRED_PERMISSIONS, targets);
        const declared =
          reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets) ||
          reflector.getAllAndOverride<boolean>(IS_AUTHENTICATED, targets) ||
          Boolean(perms?.length);
        const method = RequestMethod[Reflect.getMetadata(METHOD_METADATA, handler) as number];
        const label = `${wrapper.name}.${name} [${method} ${String(Reflect.getMetadata(PATH_METADATA, handler))}]`;
        if (!declared) unguarded.push(label);
        for (const code of perms ?? []) if (!known.has(code)) unguarded.push(`${label}: unknown permission ${code}`);
      }
    }
    await moduleRef.close();

    expect(routes).toBeGreaterThan(10);
    expect(unguarded).toEqual([]);
  });
});
