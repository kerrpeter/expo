// Copyright 2018-present 650 Industries. All rights reserved.

#import <ABI46_0_0ExpoModulesCore/ABI46_0_0EXTaskManagerInterface.h>
#import <ABI46_0_0ExpoModulesCore/ABI46_0_0EXTaskInterface.h>
#import <ABI46_0_0ExpoModulesCore/ABI46_0_0EXTaskConsumerInterface.h>

NS_ASSUME_NONNULL_BEGIN

@protocol ABI46_0_0EXTaskDelegate <NSObject>

- (void)executeTask:(nonnull id<ABI46_0_0EXTaskInterface>)task
           withData:(nullable NSDictionary *)data
          withError:(nullable NSError *)error;

@end

@interface ABI46_0_0EXTask : NSObject <ABI46_0_0EXTaskInterface>

@property (nonatomic, strong, readonly) NSString *name;
@property (nonatomic, strong, readonly) NSString *appId;
@property (nonatomic, strong, readonly) NSString *appUrl;
@property (nonatomic, strong, readonly) id<ABI46_0_0EXTaskConsumerInterface> consumer;
@property (nonatomic, strong) NSDictionary *options;
@property (nonatomic, weak) id<ABI46_0_0EXTaskDelegate> delegate;

- (instancetype)initWithName:(nonnull NSString *)name
                       appId:(nonnull NSString *)appId
                      appUrl:(nonnull NSString *)appUrl
               consumerClass:(Class)consumerClass
                     options:(nullable NSDictionary *)options
                    delegate:(nullable id<ABI46_0_0EXTaskDelegate>)delegate;

- (void)executeWithData:(nullable NSDictionary *)data withError:(nullable NSError *)error;

@end

NS_ASSUME_NONNULL_END
